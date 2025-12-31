import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Require authentication - each user sees only their own models
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(200).json({ 
        success: true,
        models: [],
      });
    }

    const userEmail = session.user.email;
    const collection = await getCollection('creations');
    const { search } = req.query;

    // Build match filter - only show this user's content
    const matchFilter = { 
      model: { $exists: true, $ne: null, $ne: '' },
      'uploadedBy.email': userEmail,
    };
    if (search) {
      matchFilter.model = { $regex: search, $options: 'i' };
    }

    // Aggregate to get unique models with count and best image as thumbnail
    const pipeline = [
      // Only include items that have a model field
      { $match: matchFilter },
      // Sort by voteScore descending so highest voted comes first
      { $sort: { voteScore: -1, createdAt: -1 } },
      // Group by model
      {
        $group: {
          _id: '$model',
          count: { $sum: 1 },
          // Get all images to find the best one
          items: { $push: { image: '$generatedImage', type: '$type', voteScore: '$voteScore' } },
          latestDate: { $max: '$createdAt' },
        },
      },
      // Add thumbnail field - prioritize highest voted image (not video)
      {
        $addFields: {
          thumbnail: {
            $let: {
              vars: {
                // Filter to only images and get the first one (already sorted by voteScore)
                bestImage: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$items',
                        as: 'item',
                        cond: { $or: [
                          { $eq: ['$$item.type', 'image'] },
                          { $eq: ['$$item.type', null] },
                          { $not: { $ifNull: ['$$item.type', false] } }
                        ]}
                      }
                    },
                    0
                  ]
                }
              },
              // If we found an image, use it; otherwise fall back to first item
              in: {
                $ifNull: [
                  '$$bestImage.image',
                  { $arrayElemAt: ['$items.image', 0] }
                ]
              }
            }
          }
        }
      },
      // Sort by count (most popular) then by latest date
      { $sort: { count: -1, latestDate: -1 } },
      // Reshape output (remove items array)
      {
        $project: {
          _id: 0,
          name: '$_id',
          count: 1,
          thumbnail: 1,
          latestDate: 1,
        },
      },
    ];

    const models = await collection.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      models,
    });
  } catch (error) {
    console.error('Models fetch error:', error);
    return res.status(500).json({
      error: 'Failed to fetch models',
      details: error.message,
    });
  }
}
