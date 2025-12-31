import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Require authentication
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: 'Not authenticated', videos: [] });
    }

    const { imageId } = req.query;
    if (!imageId) {
      return res.status(400).json({ error: 'imageId is required', videos: [] });
    }

    const collection = await getCollection('creations');
    const votesCollection = await getCollection('votes');

    // Find all videos that were created from this image
    const videos = await collection
      .find({
        type: 'video',
        sourceImageId: imageId,
        'uploadedBy.email': session.user.email,
      })
      .sort({ voteScore: -1, createdAt: -1 })
      .toArray();

    // Get user's votes for these videos
    let userVotes = {};
    if (session.user?.id) {
      const videoIds = videos.map(v => v._id.toString());
      const votes = await votesCollection.find({
        creationId: { $in: videoIds },
        userId: session.user.id,
      }).toArray();
      
      votes.forEach(vote => {
        userVotes[vote.creationId] = vote.voteType;
      });
    }

    // Transform for response with vote info
    const transformedVideos = videos.map(video => ({
      ...video,
      _id: video._id.toString(),
      voteScore: video.voteScore || 0,
      userVote: userVotes[video._id.toString()] || null,
    }));

    return res.status(200).json({
      success: true,
      videos: transformedVideos,
    });
  } catch (error) {
    console.error('Fetch videos for image error:', error);
    return res.status(500).json({
      error: 'Failed to fetch videos',
      details: error.message,
      videos: [],
    });
  }
}

