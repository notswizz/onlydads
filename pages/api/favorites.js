import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'You must be signed in' });
  }

  const userId = session.user.id;

  if (req.method === 'GET') {
    // Get all user's favorited videos
    try {
      const favoritesCollection = await getCollection('favorites');
      const creationsCollection = await getCollection('creations');

      const favorites = await favoritesCollection
        .find({ userId })
        .sort({ createdAt: -1 })
        .toArray();

      const creationIds = favorites.map(f => new ObjectId(f.creationId));
      
      if (creationIds.length === 0) {
        return res.status(200).json({ success: true, favorites: [] });
      }

      const creations = await creationsCollection
        .find({ _id: { $in: creationIds } })
        .toArray();

      // Sort creations by favorite order
      const creationMap = new Map(creations.map(c => [c._id.toString(), c]));
      const sortedCreations = favorites
        .map(f => creationMap.get(f.creationId))
        .filter(Boolean);

      return res.status(200).json({ success: true, favorites: sortedCreations });
    } catch (error) {
      console.error('Get favorites error:', error);
      return res.status(500).json({ error: 'Failed to get favorites' });
    }
  }

  if (req.method === 'POST') {
    // Toggle favorite on a creation
    const { creationId } = req.body;

    if (!creationId) {
      return res.status(400).json({ error: 'Creation ID is required' });
    }

    try {
      const favoritesCollection = await getCollection('favorites');

      const existing = await favoritesCollection.findOne({
        userId,
        creationId,
      });

      if (existing) {
        // Remove from favorites
        await favoritesCollection.deleteOne({ _id: existing._id });
        return res.status(200).json({ success: true, favorited: false });
      } else {
        // Add to favorites
        await favoritesCollection.insertOne({
          userId,
          creationId,
          createdAt: new Date(),
        });
        return res.status(200).json({ success: true, favorited: true });
      }
    } catch (error) {
      console.error('Toggle favorite error:', error);
      return res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

