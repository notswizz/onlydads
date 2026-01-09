import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongodb';

// Credit packages (must match frontend)
const CREDIT_PACKAGES = [
  { id: 'starter', credits: 10, price: 5 },
  { id: 'popular', credits: 50, price: 20 },
  { id: 'pro', credits: 150, price: 50 },
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { packageId } = req.body;
  const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
  
  if (!pkg) {
    return res.status(400).json({ error: 'Invalid package' });
  }

  const apiKey = process.env.COINBASE_COMMERCE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('onlydads');

    // Create a pending order in our database
    const order = {
      userId: session.user.id,
      userEmail: session.user.email,
      packageId: pkg.id,
      credits: pkg.credits,
      amount: pkg.price,
      currency: 'USD',
      status: 'pending',
      createdAt: new Date(),
    };

    const orderResult = await db.collection('orders').insertOne(order);
    const orderId = orderResult.insertedId.toString();

    // Create Coinbase Commerce charge
    const chargeResponse = await fetch('https://api.commerce.coinbase.com/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CC-Api-Key': apiKey,
        'X-CC-Version': '2018-03-22',
      },
      body: JSON.stringify({
        name: `${pkg.credits} OnlyDads Credits`,
        description: `Purchase ${pkg.credits} credits for OnlyDads`,
        pricing_type: 'fixed_price',
        local_price: {
          amount: pkg.price.toString(),
          currency: 'USD',
        },
        metadata: {
          orderId,
          userId: session.user.id,
          packageId: pkg.id,
          credits: pkg.credits.toString(),
        },
        redirect_url: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}?payment=success`,
        cancel_url: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}?payment=cancelled`,
      }),
    });

    if (!chargeResponse.ok) {
      const errorData = await chargeResponse.text();
      console.error('Coinbase Commerce error:', errorData);
      return res.status(500).json({ error: 'Failed to create payment' });
    }

    const chargeData = await chargeResponse.json();

    // Update order with charge ID
    await db.collection('orders').updateOne(
      { _id: orderResult.insertedId },
      { 
        $set: { 
          chargeId: chargeData.data.id,
          chargeCode: chargeData.data.code,
        } 
      }
    );

    return res.status(200).json({
      success: true,
      checkoutUrl: chargeData.data.hosted_url,
      chargeId: chargeData.data.id,
    });
  } catch (err) {
    console.error('Create charge error:', err);
    return res.status(500).json({ error: 'Failed to create payment' });
  }
}

