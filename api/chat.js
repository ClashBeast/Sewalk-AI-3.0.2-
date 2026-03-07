// SeWalk AI — Vercel Serverless Function v3.1
// Multi-model routing: Gemini + OpenRouter + File/PDF analysis

const ALLOWED_ORIGINS = [
  'https://sewalk-ultraai.vercel.app',
  'https://sewalk-ai.vercel.app',
  'https://sewalk-3-0.vercel.app',
  'https://sewalk-ai-app.netlify.app',
  'https://sewalk-ai-302.vercel.app',
  'https://sewalk-ai-0e0188.netlify.app',
  'https://sewalk-ai-c05935.netlify.app',
  'https://sewalk-ai.netlify.app',
  'https://genuine-otter-85f43c.netlify.app',
  'http://localhost:3000',
  'http://localhost:8888',
  'https://se-walk-ai-2-0.vercel.app',
];

const MODEL_REGISTRY = {
  'walk-pulse':      { real: 'gemini-3.1-flash-lite-preview',                 route: 'gemini' },
  'walk-swift':      { real: 'gemini-1.5-flash',                              route: 'gemini' },
  'walk-pro':        { real: 'gemini-1.5-pro',                                route: 'gemini' },
  'walk-flash':      { real: 'gemini-2.0-flash',                              route: 'gemini' },
  'walk-researcher': { real: 'gemini-2.0-flash-thinking-exp',                 route: 'gemini',      premium: true },
  'walk-deep':       { real: 'meta-llama/llama-3.3-70b-instruct:free',        route: 'openrouter' },
  'walk-logic':      { real: 'deepseek/deepseek-r1:free',                     route: 'openrouter' },
  'walk-maverick':   { real: 'meta-llama/llama-4-maverick:free',              route: 'openrouter' },
  'walk-elite':      { real: 'openai/gpt-5.4-pro',                            route: 'openrouter', premium: true },
  'walk-fusion':     { real: 'mistralai/mistral-small-3.1-24b-instruct:free', route: 'openrouter' },
};

const DEFAULT_MODEL = 'walk-pulse';

// ── Gemini API ────────────────────────────────────────────────
async function callGemini(apiKey, modelId, systemPrompt, messages, image, fileData) {
  const contents = messages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

  // Image attachment
  if (image && image.base64) {
    const imagePart = { inline_data: { mime_type: image.mime || 'image/jpeg', data: image.base64 } };
    const textPart  = { text: image.text || 'Please analyse this image.' };
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts = [imagePart, textPart];
    } else {
      contents.push({ role: 'user', parts: [imagePart, textPart] });
    }
  }

  // File/PDF/document attachment
  if (fileData && fileData.base64) {
    const filePart = { inline_data: { mime_type: fileData.mime, data: fileData.base64 } };
    const textPart = { text: fileData.text || `Please analyse this ${fileData.type || 'file'} and provide a detailed summary.` };
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts = [filePart, textPart];
    } else {
      contents.push({ role: 'user', parts: [filePart, textPart] });
    }
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      }),
    }
  );
  const data = await resp.json();
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || `Gemini error ${resp.status}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
}

// ── OpenRouter API ────────────────────────────────────────────
async function callOpenRouter(apiKey, modelId, systemPrompt, messages) {
  const orMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  ];

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://sewalk-ultraai.vercel.app',
      'X-Title': 'SeWalk AI',
    },
    body: JSON.stringify({
      model: modelId,
      messages: orMessages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || `OpenRouter error ${resp.status}`);
  return data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
}

// ── Image Generation via OpenRouter ──────────────────────────
async function generateImage(apiKey, prompt) {
  // Use Gemini for image generation (free)
  const geminiKey = process.env.GEMINI_API_KEY;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${geminiKey}`,
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
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || 'Image generation failed');
  // Extract base64 image from response
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData);
  if (imgPart) {
    return {
      type: 'image',
      base64: imgPart.inlineData.data,
      mime: imgPart.inlineData.mimeType || 'image/png',
    };
  }
  // Fallback: return text description
  const textPart = parts.find(p => p.text);
  return { type: 'text', text: textPart?.text || 'Could not generate image.' };
}

// ── Web Search via Serper ────────────────────────────────────
async function webSearch(query) {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    // Fallback: use Gemini with web search grounding
    return null;
  }
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  const data = await resp.json();
  const results = data?.organic?.slice(0, 5).map(r => `**${r.title}**\n${r.snippet}\n${r.link}`).join('\n\n') || '';
  return results;
}

// ── Main Handler ──────────────────────────────────────────────
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
    const body = req.body;
    const selectedModel = body.model || DEFAULT_MODEL;
    const modelConfig = MODEL_REGISTRY[selectedModel] || MODEL_REGISTRY[DEFAULT_MODEL];
    const systemPrompt = body.system || 'You are a helpful assistant.';
    const messages = body.messages || [];
    const image = body.image || null;
    const fileData = (body.fileBase64) ? {
      base64: body.fileBase64,
      mime: body.fileMime || 'application/pdf',
      type: body.fileType || 'file',
      text: body.imageText || 'Please analyse this file.',
    } : null;

    // ── Image Generation request ──
    if (body.mode === 'image_gen') {
      const result = await generateImage(process.env.GEMINI_API_KEY, body.prompt || messages[messages.length-1]?.content || '');
      if (result.type === 'image') {
        return res.status(200).json({ imageBase64: result.base64, imageMime: result.mime });
      }
      return res.status(200).json({ content: [{ type: 'text', text: result.text }] });
    }

    // ── Web Search request ──
    if (body.mode === 'web_search') {
      const query = body.query || messages[messages.length-1]?.content || '';
      const searchResults = await webSearch(query);
      let finalSystem = systemPrompt;
      if (searchResults) {
        finalSystem = `${systemPrompt}\n\nYou have access to these real-time web search results for the query "${query}":\n\n${searchResults}\n\nAnswer based on these results. Cite sources where relevant.`;
      } else {
        finalSystem = `${systemPrompt}\n\nThe user wants web search results for: "${query}". Answer with the most accurate information you know. Format with 🌐 Web Search Results heading. Be transparent about your knowledge cutoff.`;
      }
      const geminiKey = process.env.GEMINI_API_KEY;
      const text = await callGemini(geminiKey, 'gemini-3.1-flash-lite-preview', finalSystem, [{ role: 'user', content: query }], null, null);
      return res.status(200).json({ content: [{ type: 'text', text }] });
    }

    // ── Regular chat ──
    let text;
    if (modelConfig.route === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
      text = await callGemini(apiKey, modelConfig.real, systemPrompt, messages, image, fileData);
    } else {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
      // For OpenRouter, if file attached fall back to Gemini (multimodal)
      if (fileData || image) {
        const geminiKey = process.env.GEMINI_API_KEY;
        text = await callGemini(geminiKey, 'gemini-1.5-pro', systemPrompt, messages, image, fileData);
      } else {
        text = await callOpenRouter(apiKey, modelConfig.real, systemPrompt, messages);
      }
    }

    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    console.error('SeWalk AI chat error:', err.message);
    const isLimit = /limit|quota|rate|429|exceeded/i.test(err.message);
    if (isLimit) {
      return res.status(429).json({ upgradeRequired: true, message: 'Usage limit reached.' });
    }
    return res.status(500).json({
      content: [{ type: 'text', text: `⚠️ Server error: ${err.message}` }],
    });
  }
}
