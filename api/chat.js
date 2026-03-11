// SeWalk AI — Vercel Serverless Function v3.2
// Multi-model routing: Gemini + OpenRouter + File/PDF analysis
// Security: rate limiting, input sanitization, injection guard, security headers
// NEW: Widgets — web search (Serper), weather (OpenWeatherMap), YouTube

import crypto from 'crypto';

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

// ── ORIGINAL model IDs — untouched ────────────────────────────
const MODEL_REGISTRY = {
  'walk-pulse':      { real: 'gemini-3.1-flash-lite-preview',                 route: 'gemini' },
  'walk-swift':      { real: 'gemini-3.1-flash-lite-preview',                 route: 'gemini' },
  'walk-pro':        { real: 'gemini-3.1-pro-preview',                        route: 'gemini' },
  'walk-flash':      { real: 'gemini-3-flash-preview',                        route: 'gemini' },
  'walk-researcher': { real: 'gemini-3.1-pro-preview',                        route: 'gemini',     premium: true },
  'walk-deep':       { real: 'meta-llama/llama-3.3-70b-instruct:free',        route: 'openrouter' },
  'walk-logic':      { real: 'deepseek/deepseek-r1:free',                     route: 'openrouter' },
  'walk-maverick':   { real: 'meta-llama/llama-4-maverick:free',              route: 'openrouter' },
  'walk-elite':      { real: 'openai/gpt-5.4-pro',                            route: 'openrouter', premium: true },
  'walk-fusion':     { real: 'mistralai/mistral-small-3.1-24b-instruct:free', route: 'openrouter' },
};

const DEFAULT_MODEL = 'walk-pulse';

// ── In-memory rate limiter ────────────────────────────────────
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

// ── Input sanitizer ───────────────────────────────────────────
function sanitizeString(str, maxLen = 4096) {
  if (typeof str !== 'string') return '';
  return str.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen);
}

function sanitizeMessages(messages, maxMessages = 50) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-maxMessages)
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .map(m => ({
      role: m.role,
      content: sanitizeString(typeof m.content === 'string' ? m.content : JSON.stringify(m.content), 8192),
    }));
}

// ── Prompt injection guard ────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+DAN/i,
  /\[\s*system\s*\]/i,
  /<\s*system\s*>/i,
  /jailbreak/i,
  /forget\s+(everything|your\s+instructions)/i,
];

function hasPromptInjection(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

// ── Security headers ──────────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
}

// ── Gemini API ────────────────────────────────────────────────
async function callGemini(apiKey, modelId, systemPrompt, messages, image, fileData) {
  const contents = messages
    .filter(msg => msg.role !== 'system')
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

  if (image && image.base64) {
    const imagePart = { inline_data: { mime_type: image.mime || 'image/jpeg', data: image.base64 } };
    const textPart  = { text: image.text || 'Please analyse this image.' };
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts = [imagePart, textPart];
    } else {
      contents.push({ role: 'user', parts: [imagePart, textPart] });
    }
  }

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
    body: JSON.stringify({ model: modelId, messages: orMessages, max_tokens: 2048, temperature: 0.7 }),
  });
  const data = await resp.json();
  if (!resp.ok || data?.error) throw new Error(data?.error?.message || `OpenRouter error ${resp.status}`);
  return data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
}

// ── Image Generation ──────────────────────────────────────────
async function generateImage(prompt) {
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
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData);
  if (imgPart) return { type: 'image', base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/png' };
  const textPart = parts.find(p => p.text);
  return { type: 'text', text: textPart?.text || 'Could not generate image.' };
}

// ── Web Search (Serper) ───────────────────────────────────────
async function webSearch(query) {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) return null;
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
    body: JSON.stringify({ q: query, num: 6 }),
  });
  const data = await resp.json();
  if (!resp.ok) return null;

  const organic = data?.organic?.slice(0, 5).map(r => ({
    title: r.title,
    snippet: r.snippet,
    link: r.link,
    source: r.displayLink || (() => { try { return new URL(r.link).hostname; } catch { return r.link; } })(),
  })) || [];

  return {
    organic,
    answerBox: data?.answerBox?.answer || data?.answerBox?.snippet || null,
    knowledgeGraph: data?.knowledgeGraph?.description || null,
  };
}

// ── Weather (OpenWeatherMap) ──────────────────────────────────
async function getWeather(city) {
  const weatherKey = process.env.OPENWEATHER_API_KEY;
  if (!weatherKey) return null;
  const resp = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${weatherKey}&units=metric`
  );
  const data = await resp.json();
  if (!resp.ok || data.cod !== 200) return null;
  return {
    city: data.name,
    country: data.sys.country,
    temp: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    wind_speed: Math.round(data.wind.speed * 3.6),
    description: data.weather[0].description,
    icon: data.weather[0].icon,
    condition: data.weather[0].main,
    visibility: data.visibility ? Math.round(data.visibility / 1000) : null,
    pressure: data.main.pressure,
  };
}

// ── YouTube Search ────────────────────────────────────────────
async function youtubeSearch(query) {
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) return null;
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=4&type=video&key=${ytKey}`
  );
  const data = await resp.json();
  if (!resp.ok || data.error) return null;
  return data.items?.map(item => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    publishedAt: item.snippet.publishedAt,
    description: item.snippet.description?.slice(0, 120),
  })) || [];
}

// ── AI commentary ─────────────────────────────────────────────
async function generateCommentary(systemPrompt, contextData, widgetType, query) {
  const geminiKey = process.env.GEMINI_API_KEY;
  let prompt = '';
  if (widgetType === 'weather') {
    prompt = `User asked about weather in ${contextData.city}. Data: ${contextData.temp}°C, feels like ${contextData.feels_like}°C, ${contextData.description}, humidity ${contextData.humidity}%, wind ${contextData.wind_speed} km/h. Write 1-2 friendly, natural sentences commenting on this weather.`;
  } else if (widgetType === 'web_search') {
    const titles = contextData.organic?.slice(0, 3).map(r => r.title).join(', ');
    prompt = `User searched: "${query}". Top results about: ${titles}. Write 1-2 sentences summarizing what was found conversationally. Start with "Here's what I found..." or similar.`;
  } else if (widgetType === 'youtube') {
    const videos = contextData.slice(0, 3).map(v => v.title).join(', ');
    prompt = `User asked for YouTube videos about: "${query}". Found: ${videos}. Write 1-2 sentences introducing these results like a helpful assistant.`;
  }
  if (!prompt) return null;
  try {
    return await callGemini(geminiKey, 'gemini-3.1-flash-lite-preview',
      systemPrompt || 'You are a helpful assistant.',
      [{ role: 'user', content: prompt }], null, null);
  } catch { return null; }
}

// ── Main Handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SeWalk-Session');
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  const clientIP = getClientIP(req);
  const ipLimit = checkRateLimit(`ip:${clientIP}`, 200, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipLimit.resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  const sessionKey = req.headers['x-sewalk-session'];
  if (!sessionKey) {
    const guestLimit = checkRateLimit(`guest:${clientIP}`, 10, 60 * 60 * 1000);
    if (!guestLimit.allowed) {
      return res.status(429).json({ upgradeRequired: true, message: 'Guest limit reached. Sign in for more messages.' });
    }
  }

  try {
    const body = req.body;
    const selectedModel = body.model || DEFAULT_MODEL;
    const modelConfig = MODEL_REGISTRY[selectedModel] || MODEL_REGISTRY[DEFAULT_MODEL];
    const systemPrompt = sanitizeString(body.system || 'You are a helpful assistant.', 2048);
    const messages = sanitizeMessages(body.messages);
    const lastMsg = messages.filter(m => m.role === 'user').pop()?.content || '';

    if (hasPromptInjection(lastMsg)) {
      return res.status(400).json({ error: 'Invalid message content.' });
    }

    const image = body.image || null;
    const fileData = (body.fileBase64) ? {
      base64: body.fileBase64,
      mime: body.fileMime || 'application/pdf',
      type: body.fileType || 'file',
      text: body.imageText || 'Please analyse this file.',
    } : null;

    // ── IMAGE GENERATION ──────────────────────────────────
    if (body.mode === 'image_gen') {
      const prompt = sanitizeString(body.prompt || lastMsg, 1000);
      const result = await generateImage(prompt);
      if (result.type === 'image') return res.status(200).json({ imageBase64: result.base64, imageMime: result.mime });
      return res.status(200).json({ content: [{ type: 'text', text: result.text }] });
    }

    // ── WEB SEARCH WIDGET ─────────────────────────────────
    if (body.mode === 'web_search') {
      const query = sanitizeString(body.query || lastMsg, 256);
      const searchData = await webSearch(query);
      if (searchData && searchData.organic.length > 0) {
        const commentary = await generateCommentary(systemPrompt, searchData, 'web_search', query);
        return res.status(200).json({
          widgetType: 'web_search',
          widgetData: { ...searchData, query },
          commentary: commentary || `Here are the latest results for "${query}".`,
        });
      }
      // Fallback to AI answer
      const fallback = `${systemPrompt}\n\nAnswer this web search query: "${query}". Be helpful.`;
      const text = await callGemini(process.env.GEMINI_API_KEY, 'gemini-3.1-flash-lite-preview',
        fallback, [{ role: 'user', content: query }], null, null);
      return res.status(200).json({ content: [{ type: 'text', text }] });
    }

    // ── WEATHER WIDGET ────────────────────────────────────
    if (body.mode === 'weather') {
      const city = sanitizeString(body.city || '', 100);
      if (!city) return res.status(400).json({ error: 'City name required.' });
      const weatherData = await getWeather(city);
      if (weatherData) {
        const commentary = await generateCommentary(systemPrompt, weatherData, 'weather', city);
        return res.status(200).json({
          widgetType: 'weather',
          widgetData: weatherData,
          commentary: commentary || `Here's the current weather in ${weatherData.city}.`,
        });
      }
      return res.status(200).json({
        content: [{ type: 'text', text: `⚠️ Couldn't find weather data for "${city}". Please check the city name.` }]
      });
    }

    // ── YOUTUBE WIDGET ────────────────────────────────────
    if (body.mode === 'youtube') {
      const query = sanitizeString(body.query || '', 256);
      if (!query) return res.status(400).json({ error: 'Query required.' });
      const videos = await youtubeSearch(query);
      if (videos && videos.length > 0) {
        const commentary = await generateCommentary(systemPrompt, videos, 'youtube', query);
        return res.status(200).json({
          widgetType: 'youtube',
          widgetData: { videos, query },
          commentary: commentary || `Here are some YouTube videos about "${query}".`,
        });
      }
      return res.status(200).json({
        content: [{ type: 'text', text: `⚠️ No YouTube videos found for "${query}". Try a different search term.` }]
      });
    }

    // ── REGULAR CHAT ──────────────────────────────────────
    let text;
    if (modelConfig.route === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
      text = await callGemini(apiKey, modelConfig.real, systemPrompt, messages, image, fileData);
    } else {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
      if (fileData || image) {
        text = await callGemini(process.env.GEMINI_API_KEY, 'gemini-3.1-pro-preview', systemPrompt, messages, image, fileData);
      } else {
        text = await callOpenRouter(apiKey, modelConfig.real, systemPrompt, messages);
      }
    }

    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    console.error('SeWalk AI chat error:', err.message);
    const isLimit = /limit|quota|rate|429|exceeded/i.test(err.message);
    if (isLimit) return res.status(429).json({ upgradeRequired: true, message: 'Usage limit reached.' });
    return res.status(500).json({ content: [{ type: 'text', text: `⚠️ Something went wrong. Please try again.` }] });
  }
}
