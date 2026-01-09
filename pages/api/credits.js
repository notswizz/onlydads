import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getCredits, CREDIT_PACKAGES, CREDIT_COSTS } from '../../lib/credits';

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

  // POST - Disabled (use /api/payments/create-charge for Coinbase Commerce)
  if (req.method === 'POST') {
    return res.status(400).json({ 
      error: 'Direct purchase disabled. Use crypto payment.',
      redirect: '/api/payments/create-charge'
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

