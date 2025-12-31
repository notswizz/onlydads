import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET;

/**
 * Upload a file to S3
 * @param {Buffer|string} data - The file data (Buffer or base64 string)
 * @param {string} key - The S3 object key (path/filename)
 * @param {string} contentType - The MIME type
 * @returns {Promise<string>} - The public URL of the uploaded file
 */
export async function uploadToS3(data, key, contentType) {
  let buffer;
  
  // Handle base64 data URLs
  if (typeof data === 'string') {
    if (data.startsWith('data:')) {
      // Extract base64 from data URL
      const base64Data = data.split(',')[1];
      buffer = Buffer.from(base64Data, 'base64');
    } else if (data.startsWith('http')) {
      // Fetch from URL and convert to buffer
      const response = await fetch(data);
      if (!response.ok) {
        throw new Error('Failed to fetch file from URL');
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // Assume it's already base64
      buffer = Buffer.from(data, 'base64');
    }
  } else {
    buffer = data;
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Return the public URL
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

/**
 * Generate a unique filename
 * @param {string} prefix - Prefix for the filename
 * @param {string} extension - File extension
 * @returns {string} - Unique filename
 */
export function generateFileName(prefix, extension) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}/${timestamp}-${random}.${extension}`;
}

/**
 * Get content type from data URL or extension
 * @param {string} data - Data URL or filename
 * @param {string} type - 'image' or 'video'
 * @returns {string} - MIME type
 */
export function getContentType(data, type = 'image') {
  if (typeof data === 'string' && data.startsWith('data:')) {
    const match = data.match(/data:([^;]+);/);
    if (match) return match[1];
  }
  
  return type === 'video' ? 'video/mp4' : 'image/jpeg';
}

