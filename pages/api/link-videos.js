import { getCollection } from '../../lib/mongodb';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const collection = await getCollection('creations');

    // Get all videos that don't have sourceImageId
    const videos = await collection.find({
      type: 'video',
      sourceImageId: { $exists: false }
    }).toArray();

    console.log(`Found ${videos.length} unlinked videos`);

    let linked = 0;
    let unlinked = 0;

    for (const video of videos) {
      // Try to find the source image by matching:
      // 1. Same model
      // 2. Same originalImage (if exists)
      // 3. Type is 'image'
      
      const query = {
        type: 'image',
        model: video.model,
      };
      
      // If video has originalImage, use that to find the source
      if (video.originalImage) {
        query.originalImage = video.originalImage;
      }

      // Find potential source images, prefer the one created before the video
      const sourceImages = await collection.find({
        ...query,
        createdAt: { $lte: video.createdAt }
      }).sort({ createdAt: -1 }).limit(1).toArray();

      if (sourceImages.length > 0) {
        const sourceImage = sourceImages[0];
        
        // Update the video with the sourceImageId
        await collection.updateOne(
          { _id: video._id },
          { $set: { sourceImageId: sourceImage._id.toString() } }
        );
        linked++;
        console.log(`Linked video ${video._id} to image ${sourceImage._id}`);
      } else {
        // Try without the date constraint
        const anySourceImages = await collection.find(query).limit(1).toArray();
        
        if (anySourceImages.length > 0) {
          await collection.updateOne(
            { _id: video._id },
            { $set: { sourceImageId: anySourceImages[0]._id.toString() } }
          );
          linked++;
          console.log(`Linked video ${video._id} to image ${anySourceImages[0]._id} (fallback)`);
        } else {
          unlinked++;
          console.log(`Could not find source image for video ${video._id} (model: ${video.model})`);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${videos.length} videos: ${linked} linked, ${unlinked} could not be linked`,
      totalVideos: videos.length,
      linked,
      unlinked,
    });
  } catch (error) {
    console.error('Link videos error:', error);
    return res.status(500).json({
      error: 'Failed to link videos',
      details: error.message,
    });
  }
}

