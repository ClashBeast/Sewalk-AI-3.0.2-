// SeWalk AI — Session Token Endpoint v1.0
// Issues short-lived HMAC tokens for frontend request signing
// Add REQUEST_SECRET to Vercel env vars to enable request signing

import crypto from 'crypto';

const ALLOWED_ORIGINS = new Set([
  'https://sewalk-ultraai.vercel.app',
  'https://sewalk-ai.vercel.app',
  'https://sewalk-3-0.vercel.app',
  'https://sewalk-ai-302.vercel.app',
  'http://localhost:3000',
  'http://localhost:8888',
]);

export default function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const isAllowed = ALLOWED_ORIGINS.has(origin);

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Powered-By');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed)              return res.status(403).json({ error: 'Forbidden' });

  const secret = process.env.REQUEST_SECRET;
  if (!secret) {
    // Signing disabled — return null token
    return res.status(200).json({ token: null });
  }

  // Issue a token valid for 1 hour, scoped to this origin
  const expiry  = Date.now() + 60 * 60 * 1000;
  const payload = `${origin}:${expiry}`;
  const token   = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return res.status(200).json({
    token:  `${token}:${expiry}`,
    expiry: expiry,
  });
}
