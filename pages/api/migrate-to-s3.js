import { getCollection } from '../../lib/mongodb';
import { uploadToS3, generateFileName } from '../../lib/s3';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
  maxDuration: 300, // 5 minutes for Vercel
};

// Check if S3 is configured
const isS3Configured = () => {
  return process.env.AWS_ACCESS_KEY_ID && 
         process.env.AWS_SECRET_ACCESS_KEY && 
         process.env.AWS_S3_BUCKET;
};

// Check if URL is a Replicate URL
const isReplicateUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return url.includes('replicate.delivery') || url.includes('replicate.com');
};

// Download and upload to S3
async function migrateUrl(url, type = 'image') {
  try {
    console.log(`Fetching: ${url.substring(0, 80)}...`);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Failed to fetch (${response.status}): ${url.substring(0, 50)}...`);
      return null; // URL expired or invalid
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const extension = type === 'video' ? 'mp4' : 'jpg';
    const contentType = type === 'video' ? 'video/mp4' : 'image/jpeg';
    const folder = type === 'video' ? 'videos' : 'images';
    const key = generateFileName(folder, extension);
    
    const s3Url = await uploadToS3(buffer, key, contentType);
    console.log(`Uploaded to S3: ${s3Url}`);
    return s3Url;
  } catch (err) {
    console.error(`Migration failed for ${url.substring(0, 50)}:`, err.message);
    return null;
  }
}

export default async function handler(req, res) {
  // Only allow POST for security
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST to run migration' });
  }

  // Check S3 configuration
  if (!isS3Configured()) {
    return res.status(400).json({ 
      error: 'S3 not configured. Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET to .env.local' 
    });
  }

  try {
    const collection = await getCollection('creations');
    
    // Find all creations with Replicate URLs
    const creations = await collection.find({}).toArray();
    
    console.log(`Found ${creations.length} total creations`);
    
    const results = {
      total: creations.length,
      migrated: 0,
      skipped: 0,
      failed: 0,
      alreadyS3: 0,
      details: [],
    };

    for (const creation of creations) {
      const updates = {};
      let needsUpdate = false;
      
      // Check generatedImage
      if (isReplicateUrl(creation.generatedImage)) {
        const type = creation.type === 'video' ? 'video' : 'image';
        const newUrl = await migrateUrl(creation.generatedImage, type);
        
        if (newUrl) {
          updates.generatedImage = newUrl;
          needsUpdate = true;
          results.details.push({
            id: creation._id.toString(),
            field: 'generatedImage',
            status: 'migrated',
            oldUrl: creation.generatedImage.substring(0, 50) + '...',
            newUrl: newUrl,
          });
        } else {
          results.failed++;
          results.details.push({
            id: creation._id.toString(),
            field: 'generatedImage',
            status: 'failed',
            reason: 'Could not fetch URL (may be expired)',
          });
        }
      } else if (creation.generatedImage?.includes('s3.')) {
        results.alreadyS3++;
      }
      
      // Check originalImage (if it's a Replicate URL)
      if (isReplicateUrl(creation.originalImage)) {
        const newUrl = await migrateUrl(creation.originalImage, 'image');
        
        if (newUrl) {
          updates.originalImage = newUrl;
          needsUpdate = true;
        }
      }
      
      // Update the document if needed
      if (needsUpdate) {
        await collection.updateOne(
          { _id: creation._id },
          { $set: updates }
        );
        results.migrated++;
        console.log(`Updated creation ${creation._id}`);
      } else if (!isReplicateUrl(creation.generatedImage)) {
        results.skipped++;
      }
    }

    console.log('Migration complete:', results);
    
    return res.status(200).json({
      success: true,
      message: 'Migration complete',
      results: {
        total: results.total,
        migrated: results.migrated,
        alreadyS3: results.alreadyS3,
        skipped: results.skipped,
        failed: results.failed,
      },
      details: results.details,
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({
      error: 'Migration failed',
      details: error.message,
    });
  }
}

