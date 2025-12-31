import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const collection = await getCollection('creations');

    // Update all creations to have uploadedBy set to emailswizz@gmail.com
    const result = await collection.updateMany(
      {}, // Match all documents
      {
        $set: {
          'uploadedBy.email': 'emailswizz@gmail.com',
          'uploadedBy.name': 'swizz',
        }
      }
    );

    return res.status(200).json({
      success: true,
      message: `Updated ${result.modifiedCount} creations to be owned by emailswizz@gmail.com`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({
      error: 'Failed to migrate ownership',
      details: error.message,
    });
  }
}

