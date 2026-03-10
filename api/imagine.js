// SeWalk Creative Studio — Image Generation API v3 + Security Hardening
// Original model IDs preserved exactly — only security added
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// ── NEW: Strict origin check (fixed from original startsWith weakness) ────
const ALLOWED_ORIGINS = [
  'https://sewalk-ultraai.vercel.app',
  'https://sewalk-ai.vercel.app',
  'http://localhost:3000',
  'https://sewalk-ai-302.vercel.app',
  'http://localhost:8888',
  'http://127.0.0.1:5500',
];

// ── ORIGINAL image model IDs — untouched ─────────────────────
const IMAGE_MODELS = {
  // ── FREE ──────────────────────────────────────────────────────────────────
  'walk-fusion-pro': {
    real: 'google/gemini-3.1-flash-image-preview',
    route: 'openrouter',
    free: true,
  },
  'walk-creata-v1': {
    real: 'black-forest-labs/flux.2-klein-4b',
    route: 'openrouter',
    free: true,
  },
  'walk-dream': {
    real: 'bytedance-seed/seedream-4.5',
    route: 'openrouter',
    free: true,
  },
  'walk-riverflow': {
    real: 'sourceful/riverflow-v2-pro',
    route: 'openrouter',
    free: true,
  },
  'walk-flux-lite': {
    real: 'black-forest-labs/FLUX.1-schnell',
    route: 'together',
    free: true,
  },
  'walk-kontext': {
    real: 'black-forest-labs/FLUX.1-kontext-max',
    route: 'together',
    free: true,
  },

  // ── PAID (locked) ─────────────────────────────────────────────────────────
  'walk-vision-max':  { real: 'black-forest-labs/flux.2-max',          route: 'openrouter', free: false },
  'walk-art-pro':     { real: 'black-forest-labs/flux.2-pro',          route: 'openrouter', free: false },
  'walk-gpt-imagine': { real: 'openai/gpt-5-image-mini',               route: 'openrouter', free: false },
  'walk-gpt-ultra':   { real: 'openai/gpt-5-image',                    route: 'openrouter', free: false },
  'walk-gem-vision':  { real: 'google/gemini-3-pro-image-preview',     route: 'openrouter', free: false },
  'walk-qwen-art':    { real: 'Qwen/Qwen-Image',                       route: 'together',   free: false },
  'walk-wan-video':   { real: 'Wan-AI/Wan2.6-image',                   route: 'together',   free: false },
};

// ── NEW: In-memory rate limiter — 20 image gen requests/hr per IP ─────────
const rateLimitStore = new Map();

function getClientIP(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(key, maxReqs, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  rateLimitStore.set(key, entry);
  return { allowed: entry.count <= maxReqs, resetAt: entry.resetAt };
}

// ── NEW: Prompt safety filter ─────────────────────────────────
const BLOCKED_PROMPT_PATTERNS = [
  /\b(nude|naked|nsfw|explicit|porn|hentai)\b/i,
  /\b(child|minor|underage|loli|shota)\b.*\b(sex|nude|naked|explicit)\b/i,
];

function isPromptSafe(prompt) {
  return !BLOCKED_PROMPT_PATTERNS.some(p => p.test(prompt));
}

// ── NEW: Security headers ─────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
}

// ── OpenRouter: original logic ────────────────────────────────
async function generateOpenRouter(modelId, prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in Vercel environment');

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://sewalk-ultraai.vercel.app',
      'X-Title': 'SeWalk Creative Studio',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`OpenRouter returned non-JSON: ${text.slice(0, 120)}`); }

  if (!resp.ok) {
    throw new Error(data?.error?.message || data?.error || `OpenRouter error ${resp.status}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const imgPart = content.find(p => p.type === 'image_url');
    if (imgPart?.image_url?.url) {
      const url = imgPart.image_url.url;
      if (url.startsWith('data:')) {
        const [meta, b64] = url.split(',');
        const mime = meta.replace('data:', '').replace(';base64', '');
        return { type: 'base64', data: b64, mime };
      }
      return { type: 'url', url };
    }
  }

  const images = data?.choices?.[0]?.message?.images;
  if (images?.[0]) {
    const img = images[0];
    if (img.startsWith('data:')) {
      const [meta, b64] = img.split(',');
      const mime = meta.replace('data:', '').replace(';base64', '');
      return { type: 'base64', data: b64, mime };
    }
    return { type: 'url', url: img };
  }

  throw new Error(`No image in OpenRouter response. Content: ${JSON.stringify(content).slice(0,200)}`);
}

// ── Together AI: original logic ───────────────────────────────
async function generateTogether(modelId, prompt) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not set in Vercel environment — go to Vercel → Settings → Environment Variables and add it');

  const resp = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      prompt,
      n: 1,
      width: 1024,
      height: 1024,
      steps: 4,
      response_format: 'b64_json',
    }),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Together returned non-JSON: ${text.slice(0,120)}`); }

  if (!resp.ok) throw new Error(data?.error?.message || data?.error || `Together error ${resp.status}`);

  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { type: 'base64', data: b64, mime: 'image/png' };
  const url = data?.data?.[0]?.url;
  if (url) return { type: 'url', url };
  throw new Error('Together returned no image data');
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers['origin'] || req.headers['referer'] || '';

  // NEW: fixed from startsWith (weaker) to exact match
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (req.headers['origin'] || '*') : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed)              return res.status(403).json({ error: 'Forbidden origin' });

  // ── NEW: IP rate limiting ─────────────────────────────────
  const clientIP = getClientIP(req);
  const ipLimit = checkRateLimit(`img:${clientIP}`, 20, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipLimit.resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Too many image requests. Please wait.' });
  }

  try {
    const { model = 'walk-flux-lite', prompt } = req.body || {};
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

    const cfg = IMAGE_MODELS[model];
    if (!cfg) return res.status(400).json({ error: `Unknown model: ${model}` });
    if (!cfg.free) return res.status(403).json({ upgradeRequired: true });

    // ── NEW: Prompt safety check ──────────────────────────
    if (!isPromptSafe(prompt)) {
      return res.status(400).json({ error: 'Prompt contains disallowed content.' });
    }

    let result;
    if      (cfg.route === 'together')   result = await generateTogether(cfg.real, prompt);
    else                                 result = await generateOpenRouter(cfg.real, prompt);

    return res.status(200).json(result);

  } catch (err) {
    console.error('[SeWalk Studio]', err.message);
    const isRateLimit = /rate.limit|quota|429|exceeded|too many/i.test(err.message);
    if (isRateLimit) return res.status(429).json({ upgradeRequired: true });
    // NEW: don't leak internal error details
    return res.status(500).json({ error: 'Image generation failed. Please try again.' });
  }
}
