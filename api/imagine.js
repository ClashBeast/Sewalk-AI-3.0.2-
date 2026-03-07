// SeWalk Creative Studio — Image Generation API v2
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const ALLOWED_ORIGINS = [
  'https://sewalk-ultraai.vercel.app',
  'https://sewalk-ai.vercel.app',
  'http://localhost:3000',
  'https://sewalk-ai-302.vercel.app/imagine.html',
  'https://sewalk-ai-302.vercel.app',
  'http://localhost:8888',
  'http://127.0.0.1:5500',
];

const IMAGE_MODELS = {
  // ── FREE ──────────────────────────────────────────────────────
  'walk-fusion-pro': {
    real: 'gemini-3.1-flash-image-preview',
    route: 'gemini',
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

  // ── PAID (locked) ─────────────────────────────────────────────
  'walk-vision-max': { real: 'black-forest-labs/flux.2-max',          route: 'openrouter', free: false },
  'walk-art-pro':    { real: 'black-forest-labs/flux.2-pro',          route: 'openrouter', free: false },
  'walk-gpt-imagine':{ real: 'openai/gpt-5-image-mini',               route: 'openrouter', free: false },
  'walk-gpt-ultra':  { real: 'openai/gpt-5-image',                    route: 'openrouter', free: false },
  'walk-gem-vision': { real: 'google/gemini-3-pro-image-preview',     route: 'openrouter', free: false },
  'walk-qwen-art':   { real: 'Qwen/Qwen-Image',                       route: 'together',   free: false },
  'walk-wan-video':  { real: 'Wan-AI/Wan2.6-image',                   route: 'together',   free: false },
};

// ── Gemini image gen ──────────────────────────────────────────
async function generateGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `Gemini error ${resp.status}`);

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.data);
  if (imgPart) {
    return { type: 'base64', data: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/png' };
  }
  throw new Error('Gemini returned no image');
}

// ── OpenRouter image gen ──────────────────────────────────────
async function generateOpenRouter(modelId, prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const resp = await fetch('https://openrouter.ai/api/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://sewalk-ultraai.vercel.app',
      'X-Title': 'SeWalk Creative Studio',
    },
    body: JSON.stringify({ model: modelId, prompt, n: 1, size: '1024x1024' }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || data?.error || `OpenRouter error ${resp.status}`);

  const url = data?.data?.[0]?.url;
  if (url) return { type: 'url', url };
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { type: 'base64', data: b64, mime: 'image/png' };
  throw new Error('OpenRouter returned no image');
}

// ── Together AI image gen ─────────────────────────────────────
async function generateTogether(modelId, prompt) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error('TOGETHER_API_KEY not set');

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

  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || data?.error || `Together error ${resp.status}`);

  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { type: 'base64', data: b64, mime: 'image/png' };
  const url = data?.data?.[0]?.url;
  if (url) return { type: 'url', url };
  throw new Error('Together returned no image');
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (req.headers['origin'] || '*') : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed)              return res.status(403).json({ error: 'Forbidden origin' });

  try {
    const { model = 'walk-flux-lite', prompt } = req.body || {};
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

    const cfg = IMAGE_MODELS[model];
    if (!cfg) return res.status(400).json({ error: `Unknown model: ${model}` });
    if (!cfg.free) return res.status(403).json({ upgradeRequired: true });

    let result;
    if      (cfg.route === 'gemini')      result = await generateGemini(prompt);
    else if (cfg.route === 'together')    result = await generateTogether(cfg.real, prompt);
    else                                  result = await generateOpenRouter(cfg.real, prompt);

    return res.status(200).json(result);

  } catch (err) {
    console.error('[SeWalk Studio]', err.message);
    const isRateLimit = /rate.limit|quota|429|exceeded|too many/i.test(err.message);
    if (isRateLimit) return res.status(429).json({ upgradeRequired: true });
    return res.status(500).json({ error: err.message });
  }
}
