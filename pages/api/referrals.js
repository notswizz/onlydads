import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { addCredits } from '../../lib/credits';

// Credits awarded for referrals
const REFERRAL_REWARDS = {
  referrer: 10,  // Credits for the person who referred
  referee: 5,    // Credits for the new user who signed up
};

// Generate a unique referral code
function generateReferralCode(userId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  
  const client = await clientPromise;
  const db = client.db('onlydads');
  const usersCollection = db.collection('users');
  const referralsCollection = db.collection('referrals');

  const userId = session?.user?.id;

  // Handle click tracking (doesn't require auth)
  if (req.method === 'POST' && req.body?.action === 'click') {
    const { referralCode } = req.body;
    
    if (!referralCode) {
      return res.status(400).json({ error: 'Referral code required' });
    }

    try {
      // Find the referrer by code
      const referrer = await usersCollection.findOne({ referralCode });
      
      if (!referrer) {
        return res.status(404).json({ error: 'Invalid referral code' });
      }

      // Increment click count on the referrer's record
      await usersCollection.updateOne(
        { referralCode },
        { $inc: { referralClicks: 1 } }
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Track click error:', err);
      return res.status(500).json({ error: 'Failed to track click' });
    }
  }

  // All other operations require authentication
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    // Get user's referral info
    try {
      let user = await usersCollection.findOne({ visitorId: userId });
      
      // Generate referral code if doesn't exist
      if (!user?.referralCode) {
        const referralCode = generateReferralCode(userId);
        await usersCollection.updateOne(
          { visitorId: userId },
          { 
            $set: { 
              referralCode,
              referralCreatedAt: new Date()
            }
          },
          { upsert: true }
        );
        user = await usersCollection.findOne({ visitorId: userId });
      }

      // Get referral stats
      const referralStats = await referralsCollection.aggregate([
        { $match: { referrerId: userId } },
        {
          $group: {
            _id: null,
            totalSignups: { $sum: { $cond: ['$signedUp', 1, 0] } },
            totalCreditsEarned: { $sum: '$creditsAwarded' }
          }
        }
      ]).toArray();

      const stats = {
        clicks: user.referralClicks || 0,
        signups: referralStats[0]?.totalSignups || 0,
        creditsEarned: referralStats[0]?.totalCreditsEarned || 0
      };

      // Get recent referrals
      const recentReferrals = await referralsCollection.find(
        { referrerId: userId, signedUp: true }
      )
        .sort({ signedUpAt: -1 })
        .limit(5)
        .toArray();

      return res.status(200).json({
        success: true,
        referralCode: user.referralCode,
        stats,
        rewards: REFERRAL_REWARDS,
        recentReferrals: recentReferrals.map(r => ({
          date: r.signedUpAt,
          credits: r.creditsAwarded
        }))
      });
    } catch (err) {
      console.error('Get referral info error:', err);
      return res.status(500).json({ error: 'Failed to get referral info' });
    }
  }

  if (req.method === 'POST') {
    const { action } = req.body;

    // Complete a referral (called when new user signs up)
    if (action === 'complete') {
      const { referralCode } = req.body;
      
      if (!referralCode) {
        return res.status(200).json({ success: true, message: 'No referral code provided' });
      }

      try {
        // Find the referrer by code
        const referrer = await usersCollection.findOne({ referralCode });
        
        if (!referrer) {
          return res.status(200).json({ success: true, message: 'Invalid referral code' });
        }

        // Don't let users refer themselves
        if (referrer.visitorId === userId) {
          return res.status(200).json({ success: true, message: 'Cannot use your own referral' });
        }

        // Check if this user was already referred
        const existingReferral = await referralsCollection.findOne({
          refereeId: userId
        });

        if (existingReferral) {
          return res.status(200).json({ success: true, message: 'Already referred' });
        }

        // Award credits to both parties
        await addCredits(referrer.visitorId, REFERRAL_REWARDS.referrer);
        await addCredits(userId, REFERRAL_REWARDS.referee);

        // Record the referral
        await referralsCollection.insertOne({
          referrerId: referrer.visitorId,
          refereeId: userId,
          referralCode,
          signedUp: true,
          signedUpAt: new Date(),
          creditsAwarded: REFERRAL_REWARDS.referrer,
          createdAt: new Date()
        });

        return res.status(200).json({
          success: true,
          creditsAwarded: REFERRAL_REWARDS.referee,
          message: `You earned ${REFERRAL_REWARDS.referee} bonus credits!`
        });
      } catch (err) {
        console.error('Complete referral error:', err);
        return res.status(500).json({ error: 'Failed to complete referral' });
      }
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

