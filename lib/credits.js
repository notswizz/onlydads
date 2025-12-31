import { getCollection } from './mongodb';

// Credit costs
export const CREDIT_COSTS = {
  image: 1,
  video: 5,
};

// Default credits for new users
export const DEFAULT_CREDITS = 10;

// Credit packages (for future payment integration)
export const CREDIT_PACKAGES = [
  { id: 'starter', credits: 25, price: 5, label: '25 Credits', popular: false },
  { id: 'popular', credits: 100, price: 15, label: '100 Credits', popular: true },
  { id: 'pro', credits: 300, price: 35, label: '300 Credits', popular: false },
];

// Get or create user record
export async function getUser(userId) {
  const collection = await getCollection('users');
  
  let user = await collection.findOne({ odId: userId });
  
  if (!user) {
    // Create new user with default credits
    user = {
      odId: userId,
      credits: DEFAULT_CREDITS,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await collection.insertOne(user);
  }
  
  return user;
}

// Get user's credit balance
export async function getCredits(userId) {
  const user = await getUser(userId);
  return user.credits;
}

// Check if user has enough credits
export async function hasEnoughCredits(userId, type = 'image') {
  const credits = await getCredits(userId);
  const cost = CREDIT_COSTS[type] || 1;
  return credits >= cost;
}

// Deduct credits for a generation
export async function deductCredits(userId, type = 'image') {
  const collection = await getCollection('users');
  const cost = CREDIT_COSTS[type] || 1;
  
  const result = await collection.findOneAndUpdate(
    { odId: userId, credits: { $gte: cost } },
    { 
      $inc: { credits: -cost },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );
  
  if (!result) {
    throw new Error('Insufficient credits');
  }
  
  return result.credits;
}

// Add credits to user (for purchases or bonuses)
export async function addCredits(userId, amount) {
  const collection = await getCollection('users');
  
  // Ensure user exists
  await getUser(userId);
  
  const result = await collection.findOneAndUpdate(
    { odId: userId },
    { 
      $inc: { credits: amount },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );
  
  return result.credits;
}

// Log credit transaction (for future reference)
export async function logTransaction(userId, type, amount, description) {
  const collection = await getCollection('transactions');
  
  await collection.insertOne({
    odId: userId,
    type, // 'deduct' | 'add' | 'purchase'
    amount,
    description,
    createdAt: new Date(),
  });
}
