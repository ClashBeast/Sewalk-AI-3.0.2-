// SeWalk Creative Studio — Image Generation API
// Routes: Gemini, OpenRouter, Together AI

const ALLOWED_ORIGINS = [
  'https://sewalk-ultraai.vercel.app',
  'https://sewalk-ai.vercel.app',
  'https://se-walk-ai-2-0.vercel.app',
  'https://sewalk-ai-302.vercel.app',
  'http://localhost:3000',
  'http://localhost:8888',
];

const IMAGE_MODELS = {
  // Free — Gemini
  'walk-fusion-pro':  { real: 'gemini-3.1-flash-image', route: 'gemini' },
  // Free — OpenRouter
  'walk-creata-v1':   { real: 'black-forest-labs/flux-1.1-pro',             route: 'openrouter' },
  'walk-dream':       { real: 'bytedance-seed/seedream-3.0',                route: 'openrouter' },
  'walk-riverflow':   { real: 'black-forest-labs/flux-1-schnell',           route: 'openrouter' },
  // Free — Together
  'walk-flux-lite':   { real: 'black-forest-labs/FLUX.1-schnell',           route: 'together' },
  'walk-kontext':     { real: 'black-forest-labs/FLUX.1-schnell',           route: 'together' },
  // Paid — locked
  'walk-vision-max':  { real: 'black-forest-labs/flux-1.1-pro-ultra',       route: 'openrouter', premium: true },
  'walk-art-pro':     { real: 'black-forest-labs/flux-1.1-pro',             route: 'openrouter', premium: true },
  'walk-gpt-imagine': { real: 'openai/gpt-image-1',                         route: 'openrouter', premium: true },
  'walk-gpt-ultra':   { real: 'openai/gpt-image-1',                         route: 'openrouter', premium: true },
  'walk-gem-vision':  { real: 'google/gemini-2.0-flash-exp',                route: 'openrouter', premium: true },
};

async function generateGemini(apiKey, prompt) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    }
  );
  const data = await resp.json();
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || 'Gemini image gen failed');
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData);
  if (imgPart) return { type: 'base64', data: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/png' };
  throw new Error('No image returned from Gemini');
}

async function generateOpenRouter(apiKey, modelId, prompt) {
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
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || 'OpenRouter image gen failed');
  const url = data?.data?.[0]?.url;
  if (url) return { type: 'url', url };
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { type: 'base64', data: b64, mime: 'image/png' };
  throw new Error('No image returned from OpenRouter');
}

async function generateTogether(apiKey, modelId, prompt) {
  const resp = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: modelId, prompt, n: 1, width: 1024, height: 1024, steps: 4 }),
  });
  const data = await resp.json();
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || 'Together image gen failed');
  const url = data?.data?.[0]?.url;
  if (url) return { type: 'url', url };
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return { type: 'base64', data: b64, mime: 'image/png' };
  throw new Error('No image returned from Together');
}

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { model = 'walk-flux-lite', prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const modelConfig = IMAGE_MODELS[model];
    if (!modelConfig) return res.status(400).json({ error: 'Unknown model' });
    if (modelConfig.premium) return res.status(403).json({ upgradeRequired: true });

    let result;
    if (modelConfig.route === 'gemini') {
      result = await generateGemini(process.env.GEMINI_API_KEY, prompt);
    } else if (modelConfig.route === 'together') {
      result = await generateTogether(process.env.TOGETHER_API_KEY, modelConfig.real, prompt);
    } else {
      result = await generateOpenRouter(process.env.OPENROUTER_API_KEY, modelConfig.real, prompt);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('SeWalk Studio error:', err.message);
    const isLimit = /limit|quota|rate|429|exceeded/i.test(err.message);
    if (isLimit) return res.status(429).json({ upgradeRequired: true });
    return res.status(500).json({ error: err.message });
  }
}
