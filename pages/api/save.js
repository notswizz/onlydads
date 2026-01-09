import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCollection } from '../../lib/mongodb';
import { uploadToS3, generateFileName, getContentType } from '../../lib/s3';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

// Check if S3 is configured
const isS3Configured = () => {
  return process.env.AWS_ACCESS_KEY_ID && 
         process.env.AWS_SECRET_ACCESS_KEY && 
         process.env.AWS_S3_BUCKET;
};

// Upload base64 image to S3 if needed
async function ensureS3Url(data, folder = 'originals') {
  if (!data) return null;
  
  // Already a URL, return as-is
  if (typeof data === 'string' && data.startsWith('http')) {
    return data;
  }
  
  // It's base64, upload to S3 if configured
  if (isS3Configured() && typeof data === 'string' && data.startsWith('data:')) {
    try {
      const contentType = getContentType(data, 'image');
      const key = generateFileName(folder, 'jpg');
      const s3Url = await uploadToS3(data, key, contentType);
      console.log(`Uploaded original to S3: ${s3Url}`);
      return s3Url;
    } catch (err) {
      console.error('Failed to upload original to S3:', err);
      // Return null instead of base64 to save DB space
      return null;
    }
  }
  
  // S3 not configured, don't store base64 (too large)
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'You must be signed in to upload' });
  }

  const { 
    originalImage, 
    generatedImage, 
    prompt, 
    dadType,
    title,
    model,
    type = 'image',
    sourceImageId = null, // For videos: the _id of the image this video was made from
    videoChain = null, // For extended videos: array of video URLs to play in sequence
  } = req.body;

  if (!generatedImage) {
    return res.status(400).json({ error: 'Generated image URL is required' });
  }

  if (!model || !model.trim()) {
    return res.status(400).json({ error: 'Model name is required' });
  }

  try {
    // Upload original image to S3 if it's base64
    const originalImageUrl = await ensureS3Url(originalImage, 'originals');
    
    const collection = await getCollection('creations');

    const creation = {
      originalImage: originalImageUrl,
      generatedImage,
      prompt: prompt || '',
      dadType: dadType || 'Classic Dad',
      title: title || generateDadTitle(),
      model: model.trim(),
      type,
      createdAt: new Date(),
      likes: 0,
      voteScore: 0,
      // For videos: link to the source image
      ...(type === 'video' && sourceImageId ? { sourceImageId } : {}),
      // For extended videos: array of video URLs to play in sequence
      ...(type === 'video' && videoChain && Array.isArray(videoChain) ? { videoChain } : {}),
      // Store user info
      uploadedBy: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      },
    };

    const result = await collection.insertOne(creation);

    return res.status(201).json({
      success: true,
      creation: {
        ...creation,
        _id: result.insertedId.toString(),
      },
    });
  } catch (error) {
    console.error('Save error:', error);
    return res.status(500).json({
      error: 'Failed to save creation',
      details: error.message,
    });
  }
}

// Generate a funny dad-themed title
function generateDadTitle() {
  const adjectives = [
    'Legendary', 'Majestic', 'Glorious', 'Supreme', 'Ultimate',
    'Epic', 'Magnificent', 'Regal', 'Distinguished', 'Noble',
    'Illustrious', 'Exalted', 'Venerable', 'Grand', 'Stellar'
  ];
  
  const dadTypes = [
    'Dad', 'Father Figure', 'Papa Bear', 'Old Sport', 'Silver Fox',
    'Patriarch', 'Dad-God', 'Father Time', 'Daddy-O', 'Pops',
    'El Padre', 'The Dad', 'Dad Prime', 'Mega Dad', 'Ultra Father'
  ];
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const dad = dadTypes[Math.floor(Math.random() * dadTypes.length)];
  
  return `${adj} ${dad}`;
}

