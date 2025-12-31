import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Require authentication - each user sees only their own gallery
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ 
        error: 'You must be signed in to view your gallery',
        creations: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false }
      });
    }

    const userEmail = session.user.email;
    const collection = await getCollection('creations');
    const votesCollection = await getCollection('votes');
    
    // Get pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { model, sort, type } = req.query;

    // Build filter - only show this user's content
    const filter = {
      model: { $exists: true, $ne: null, $ne: '' },
      'uploadedBy.email': userEmail,
    };
    if (model) {
      filter.model = model;
    }
    if (type && type !== 'all') {
      filter.type = type;
    }

    // Determine sort order - default to voteScore (top), can also sort by 'new'
    const sortOrder = sort === 'new' 
      ? { createdAt: -1 } 
      : { voteScore: -1, createdAt: -1 };

    // Fetch creations
    const creations = await collection
      .find(filter)
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count for pagination
    const total = await collection.countDocuments(filter);

    // Get user's votes for these creations
    let userVotes = {};
    if (session.user?.id) {
      const creationIds = creations.map(c => c._id.toString());
      const votes = await votesCollection.find({
        creationId: { $in: creationIds },
        userId: session.user.id,
      }).toArray();
      
      votes.forEach(vote => {
        userVotes[vote.creationId] = vote.voteType;
      });
    }

    // Transform creations
    const transformedCreations = creations.map(creation => ({
      ...creation,
      _id: creation._id.toString(),
      voteScore: creation.voteScore || 0,
      userVote: userVotes[creation._id.toString()] || null,
    }));

    return res.status(200).json({
      success: true,
      creations: transformedCreations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error('Gallery fetch error:', error);
    return res.status(500).json({
      error: 'Failed to fetch gallery',
      details: error.message,
    });
  }
}
