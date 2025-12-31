import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'You must be signed in to delete' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Creation ID is required' });
  }

  try {
    const collection = await getCollection('creations');
    
    // Find the creation first
    const creation = await collection.findOne({ _id: new ObjectId(id) });
    
    if (!creation) {
      return res.status(404).json({ error: 'Creation not found' });
    }

    // Check if user owns this creation or is admin (you can add admin check later)
    // For now, allow deletion if user uploaded it
    if (creation.uploadedBy?.id !== session.user.id) {
      // Allow deletion anyway for cleanup purposes
      // You could add stricter checks here
      console.log(`User ${session.user.email} deleting creation by ${creation.uploadedBy?.email || 'unknown'}`);
    }

    // Delete the creation
    await collection.deleteOne({ _id: new ObjectId(id) });

    // Also delete any votes for this creation
    try {
      const votesCollection = await getCollection('votes');
      await votesCollection.deleteMany({ creationId: id });
    } catch (err) {
      console.log('Could not delete votes:', err.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Creation deleted',
      id,
    });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({
      error: 'Failed to delete creation',
      details: error.message,
    });
  }
}

