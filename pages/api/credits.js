import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCredits, addCredits, CREDIT_PACKAGES, CREDIT_COSTS } from '../../lib/credits';

export default async function handler(req, res) {
  // Require authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'You must be signed in' });
  }

  const userId = session.user.id;

  // GET - Get current credit balance
  if (req.method === 'GET') {
    try {
      const credits = await getCredits(userId);
      return res.status(200).json({ 
        success: true, 
        credits,
        costs: CREDIT_COSTS,
        packages: CREDIT_PACKAGES,
      });
    } catch (error) {
      console.error('Get credits error:', error);
      return res.status(500).json({ error: 'Failed to get credits' });
    }
  }

  // POST - Add credits (mock purchase - no real payment)
  if (req.method === 'POST') {
    const { packageId } = req.body;

    if (!packageId) {
      return res.status(400).json({ error: 'Package ID required' });
    }

    const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
    if (!pkg) {
      return res.status(400).json({ error: 'Invalid package' });
    }

    try {
      // In a real app, this is where you'd verify payment with Stripe/etc
      // For now, just add the credits (mock purchase)
      const newBalance = await addCredits(userId, pkg.credits);

      return res.status(200).json({ 
        success: true, 
        credits: newBalance,
        purchased: pkg.credits,
        message: `Added ${pkg.credits} credits! (Mock purchase - no payment processed)`
      });
    } catch (error) {
      console.error('Add credits error:', error);
      return res.status(500).json({ error: 'Failed to add credits' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

