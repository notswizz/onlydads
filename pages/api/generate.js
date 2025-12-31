import { uploadToS3, generateFileName, getContentType } from '../../lib/s3';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
    responseLimit: false,
  },
};

// Check if S3 is configured
const isS3Configured = () => {
  return process.env.AWS_ACCESS_KEY_ID && 
         process.env.AWS_SECRET_ACCESS_KEY && 
         process.env.AWS_S3_BUCKET;
};

// Upload Replicate output to S3
async function uploadResultToS3(replicateUrl, type = 'image') {
  if (!isS3Configured()) {
    console.log('S3 not configured, returning Replicate URL');
    return replicateUrl;
  }
  
  try {
    console.log(`Uploading ${type} to S3...`);
    const response = await fetch(replicateUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch from Replicate');
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const extension = type === 'video' ? 'mp4' : 'jpg';
    const contentType = type === 'video' ? 'video/mp4' : 'image/jpeg';
    const key = generateFileName(type === 'video' ? 'videos' : 'images', extension);
    
    const s3Url = await uploadToS3(buffer, key, contentType);
    console.log(`Uploaded to S3: ${s3Url}`);
    return s3Url;
  } catch (err) {
    console.error('S3 upload failed, using Replicate URL:', err);
    return replicateUrl;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { referenceImages, prompt, mode = 'image', numFrames = 81 } = req.body;

  if (!referenceImages || referenceImages.length === 0) {
    return res.status(400).json({ error: 'No image provided' });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }

  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) {
    return res.status(500).json({ error: 'Add REPLICATE_API_TOKEN to .env.local' });
  }

  try {
    if (mode === 'video') {
      return await generateVideo(referenceImages, prompt, apiKey, res, numFrames);
    } else {
      return await generateImage(referenceImages, prompt, apiKey, res);
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message || 'Something went wrong' });
  }
}

async function generateImage(referenceImages, prompt, apiKey, res) {
  // Enhance prompt to preserve the female model's appearance
  const enhancedPrompt = `${prompt} IMPORTANT: Keep the female model's face, body, hair, and overall appearance exactly identical to the original image. Do not change her facial features, skin tone, hair color, hairstyle, or body proportions. Preserve her exact likeness.`;
  
  const response = await fetch('https://api.replicate.com/v1/models/bytedance/seedream-4/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        image_input: referenceImages,
        prompt: enhancedPrompt,
        size: "2K",
        width: 2048,
        height: 2048,
        max_images: 1,
        aspect_ratio: "1:1",
        enhance_prompt: true,
        sequential_image_generation: "disabled",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log('Replicate error:', errorText);
    
    if (response.status === 429) {
      try {
        const parsed = JSON.parse(errorText);
        const waitTime = (parsed.retry_after || 5) + 1;
        console.log(`Rate limited, retrying in ${waitTime}s...`);
        await new Promise(r => setTimeout(r, waitTime * 1000));
        
        const retry = await fetch('https://api.replicate.com/v1/models/bytedance/seedream-4/predictions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: {
              image_input: referenceImages,
              prompt: prompt,
              size: "2K",
              width: 2048,
              height: 2048,
              max_images: 1,
              aspect_ratio: "1:1",
              enhance_prompt: true,
              sequential_image_generation: "disabled",
            },
          }),
        });
        
        if (!retry.ok) {
          return res.status(429).json({ error: 'Rate limited - add $5+ to Replicate account' });
        }
        
        const retryPrediction = await retry.json();
        const retryResult = await pollPrediction(retryPrediction, apiKey);
        
        if (retryResult.status === 'succeeded') {
          const replicateOutput = Array.isArray(retryResult.output) ? retryResult.output[0] : retryResult.output;
          const output = await uploadResultToS3(replicateOutput, 'image');
          return res.status(200).json({ success: true, output });
        } else {
          return res.status(500).json({ error: retryResult.error || 'Generation failed' });
        }
      } catch (e) {
        return res.status(429).json({ error: 'Rate limited - add $5+ to Replicate' });
      }
    }
    
    return res.status(response.status).json({ error: 'Replicate API error' });
  }

  const prediction = await response.json();
  const result = await pollPrediction(prediction, apiKey);
  
  console.log('Image generation result:', JSON.stringify(result, null, 2));
  
  if (result.status === 'succeeded') {
    const replicateOutput = Array.isArray(result.output) ? result.output[0] : result.output;
    const output = await uploadResultToS3(replicateOutput, 'image');
    return res.status(200).json({ success: true, output });
  } else {
    // Check for NSFW/safety errors
    const errorMsg = result.error || '';
    console.log('Generation failed with error:', errorMsg);
    if (errorMsg.toLowerCase().includes('nsfw') || 
        errorMsg.toLowerCase().includes('safety') ||
        errorMsg.toLowerCase().includes('inappropriate') ||
        errorMsg.toLowerCase().includes('violat') ||
        errorMsg.toLowerCase().includes('policy') ||
        errorMsg.toLowerCase().includes('sexual') ||
        errorMsg.toLowerCase().includes('nude')) {
      return res.status(400).json({ 
        error: '🔞 Content too spicy! Try a tamer prompt or different image.' 
      });
    }
    return res.status(500).json({ error: result.error || 'Generation failed' });
  }
}

async function generateVideo(referenceImages, prompt, apiKey, res, numFrames = 81) {
  let imageData = referenceImages[0];
  
  // If it's a URL (not base64), fetch and convert to base64
  if (imageData.startsWith('http')) {
    try {
      console.log('Fetching image from URL for video generation...');
      const imageResponse = await fetch(imageData);
      if (!imageResponse.ok) {
        return res.status(400).json({ error: 'Could not fetch source image - URL may have expired' });
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
      imageData = `data:${contentType};base64,${buffer.toString('base64')}`;
      console.log('Image converted to base64 successfully');
    } catch (err) {
      console.error('Failed to fetch image:', err);
      return res.status(400).json({ error: 'Failed to fetch source image for video' });
    }
  }
  
  console.log(`Generating video with ${numFrames} frames (~${(numFrames / 16).toFixed(1)}s)`);
  
  const response = await fetch('https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        image: imageData,
        prompt: prompt,
        go_fast: false,
        num_frames: numFrames,
        resolution: "480p",
        sample_shift: 12,
        frames_per_second: 16,
        interpolate_output: true,
        enable_safety_checker: false,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log('Wan video error:', errorText);
    
    if (response.status === 429) {
      try {
        const parsed = JSON.parse(errorText);
        return res.status(429).json({ 
          error: `Rate limited - retry in ${parsed.retry_after || 10}s` 
        });
      } catch (e) {
        return res.status(429).json({ error: 'Rate limited - add $5+ to Replicate' });
      }
    }
    
    return res.status(response.status).json({ error: 'Video generation failed', details: errorText });
  }

  const prediction = await response.json();
  const result = await pollPrediction(prediction, apiKey, 300); // 5 min timeout
  
  if (result.status === 'succeeded') {
    const replicateOutput = Array.isArray(result.output) ? result.output[0] : result.output;
    const output = await uploadResultToS3(replicateOutput, 'video');
    return res.status(200).json({ success: true, output });
  } else {
    // Check for NSFW/safety errors
    const errorMsg = result.error || '';
    if (errorMsg.toLowerCase().includes('nsfw') || 
        errorMsg.toLowerCase().includes('safety') ||
        errorMsg.toLowerCase().includes('inappropriate') ||
        errorMsg.toLowerCase().includes('violat') ||
        errorMsg.toLowerCase().includes('policy') ||
        errorMsg.toLowerCase().includes('sexual') ||
        errorMsg.toLowerCase().includes('nude')) {
      return res.status(400).json({ 
        error: '🔞 Content too spicy! Try a tamer prompt or different image.' 
      });
    }
    return res.status(500).json({ error: result.error || 'Video generation failed' });
  }
}

async function pollPrediction(prediction, apiKey, maxAttempts = 180) {
  let result = prediction;
  let attempts = 0;
  
  while (
    result.status !== 'succeeded' && 
    result.status !== 'failed' && 
    result.status !== 'canceled' && 
    attempts < maxAttempts
  ) {
    await new Promise(r => setTimeout(r, 1000));
    
    const pollUrl = result.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
    const pollResponse = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    
    if (!pollResponse.ok) {
      throw new Error('Poll failed');
    }
    
    result = await pollResponse.json();
    attempts++;
  }
  
  return result;
}
