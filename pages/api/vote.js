import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'You must be signed in to vote' });
  }

  const { creationId, voteType } = req.body;

  if (!creationId) {
    return res.status(400).json({ error: 'Creation ID is required' });
  }

  if (!['up', 'down'].includes(voteType)) {
    return res.status(400).json({ error: 'Vote type must be "up" or "down"' });
  }

  const userId = session.user.id;

  try {
    const creationsCollection = await getCollection('creations');
    const votesCollection = await getCollection('votes');

    // Check if user already voted on this creation
    const existingVote = await votesCollection.findOne({
      creationId: creationId,
      userId: userId,
    });

    let voteChange = 0;
    let newUserVote = null;

    if (existingVote) {
      if (existingVote.voteType === voteType) {
        // Same vote type - remove the vote (toggle off)
        await votesCollection.deleteOne({ _id: existingVote._id });
        voteChange = voteType === 'up' ? -1 : 1;
        newUserVote = null;
      } else {
        // Different vote type - change the vote
        await votesCollection.updateOne(
          { _id: existingVote._id },
          { $set: { voteType: voteType, updatedAt: new Date() } }
        );
        // Changing from up to down = -2, from down to up = +2
        voteChange = voteType === 'up' ? 2 : -2;
        newUserVote = voteType;
      }
    } else {
      // New vote
      await votesCollection.insertOne({
        creationId: creationId,
        userId: userId,
        voteType: voteType,
        createdAt: new Date(),
      });
      voteChange = voteType === 'up' ? 1 : -1;
      newUserVote = voteType;
    }

    // Update the vote count on the creation
    await creationsCollection.updateOne(
      { _id: new ObjectId(creationId) },
      { $inc: { voteScore: voteChange } }
    );

    // Get the updated creation
    const updatedCreation = await creationsCollection.findOne({
      _id: new ObjectId(creationId),
    });

    return res.status(200).json({
      success: true,
      voteScore: updatedCreation?.voteScore || 0,
      userVote: newUserVote,
    });
  } catch (error) {
    console.error('Vote error:', error);
    return res.status(500).json({
      error: 'Failed to vote',
      details: error.message,
    });
  }
}

