import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL required' });
  }

  try {
    // Fetch the video
    console.log('Fetching video for frame extraction:', videoUrl);
    const response = await fetch(videoUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    const buffer = await response.arrayBuffer();
    
    // Convert to base64 data URL
    // We'll send the video as base64 and let the client extract the frame
    // This bypasses CORS since it goes through our server
    const base64 = Buffer.from(buffer).toString('base64');
    const dataUrl = `data:${contentType || 'video/mp4'};base64,${base64}`;

    return res.status(200).json({
      success: true,
      videoDataUrl: dataUrl,
    });
  } catch (err) {
    console.error('Extract frame error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch video' });
  }
}

