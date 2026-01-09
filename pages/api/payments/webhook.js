import crypto from 'crypto';
import clientPromise from '../../../lib/mongodb';
import { addCredits } from '../../../lib/credits';
import { ObjectId } from 'mongodb';

// Helper to read raw body
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Disable body parsing, we need raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const computedSignature = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;
  
  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-cc-webhook-signature'];

    // Verify signature if webhook secret is configured
    if (webhookSecret && signature) {
      const isValid = verifyWebhookSignature(rawBody.toString(), signature, webhookSecret);
      if (!isValid) {
        console.error('Invalid webhook signature');
        // In production, reject invalid signatures
        if (process.env.NODE_ENV === 'production') {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const event = JSON.parse(rawBody.toString());
    const { type, data } = event.event;

    console.log('Coinbase webhook event:', type);

    // Handle successful payment
    if (type === 'charge:confirmed' || type === 'charge:resolved') {
      const { metadata } = data;
      
      if (!metadata?.orderId || !metadata?.userId || !metadata?.credits) {
        console.error('Missing metadata in webhook:', metadata);
        return res.status(400).json({ error: 'Missing metadata' });
      }

      const client = await clientPromise;
      const db = client.db('onlydads');

      // Check if order already processed
      const order = await db.collection('orders').findOne({
        _id: new ObjectId(metadata.orderId)
      });

      if (!order) {
        console.error('Order not found:', metadata.orderId);
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.status === 'completed') {
        console.log('Order already completed:', metadata.orderId);
        return res.status(200).json({ success: true, message: 'Already processed' });
      }

      // Add credits to user
      const credits = parseInt(metadata.credits, 10);
      await addCredits(metadata.userId, credits);

      // Update order status
      await db.collection('orders').updateOne(
        { _id: new ObjectId(metadata.orderId) },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            chargeData: data,
          }
        }
      );

      console.log(`Added ${credits} credits to user ${metadata.userId}`);
      return res.status(200).json({ success: true });
    }

    // Handle failed/expired payments
    if (type === 'charge:failed' || type === 'charge:expired') {
      const { metadata } = data;
      
      if (metadata?.orderId) {
        const client = await clientPromise;
        const db = client.db('onlydads');
        
        await db.collection('orders').updateOne(
          { _id: new ObjectId(metadata.orderId) },
          {
            $set: {
              status: type === 'charge:failed' ? 'failed' : 'expired',
              updatedAt: new Date(),
            }
          }
        );
      }

      return res.status(200).json({ success: true });
    }

    // Acknowledge other events
    return res.status(200).json({ success: true, message: 'Event received' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

