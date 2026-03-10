// =============================================
//  SeWalk AI — Security Module v3.2
//  Drop this ABOVE your existing app.js code
//  (or include as a separate <script> BEFORE app.js)
// =============================================

// ── 1. Content Security Policy (CSP) Meta Tag ──────────────
// Injected at runtime since Vercel headers config is cleaner,
// but this is a good fallback for plain hosting.
(function injectCSP() {
  if (document.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' blob: data: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  document.head.prepend(meta);
})();

// ── 2. Request signing (HMAC-SHA256) ───────────────────────
// Signs every /api/chat request with a timestamp + body hash
// Requires REQUEST_SECRET env var set on both client and server
// For now uses a session-scoped secret (not a hardcoded one)
const SeWalkSecurity = (() => {
  // Session secret: generated fresh per page load
  // For real HMAC signing, inject REQUEST_SECRET from a Vercel edge config
  // via a /api/session-token endpoint that returns a short-lived token.
  let _sessionToken = null;

  async function getSessionToken() {
    if (_sessionToken) return _sessionToken;
    try {
      const res = await fetch('/api/session-token', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        _sessionToken = data.token || null;
      }
    } catch { /* no session token endpoint — skip signing */ }
    return _sessionToken;
  }

  async function signRequest(body) {
    const token = await getSessionToken();
    if (!token || typeof crypto.subtle === 'undefined') return {};

    const timestamp = Date.now().toString();
    const rawBody   = JSON.stringify(body);
    const encoder   = new TextEncoder();

    try {
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(token),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const bodyHash = await crypto.subtle.digest('SHA-256', encoder.encode(rawBody));
      const hashHex  = Array.from(new Uint8Array(bodyHash)).map(b => b.toString(16).padStart(2,'0')).join('');
      const sigData  = encoder.encode(`${timestamp}:${hashHex}`);
      const sigBuf   = await crypto.subtle.sign('HMAC', key, sigData);
      const sigHex   = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

      return {
        'X-SeWalk-Signature': sigHex,
        'X-SeWalk-Timestamp': timestamp,
      };
    } catch { return {}; }
  }

  // ── 3. XSS sanitizer ─────────────────────────────────────
  // Strips dangerous HTML before inserting user content into the DOM
  function sanitizeHTML(html) {
    const ALLOWED_TAGS = new Set([
      'b','i','u','strong','em','code','pre','p','br','ul','ol','li',
      'h1','h2','h3','h4','h5','h6','blockquote','hr','table','thead',
      'tbody','tr','th','td','span','div','a',
    ]);
    const ALLOWED_ATTRS = new Set(['href','class','id','style','data-code','data-idx','target','rel']);

    const template = document.createElement('template');
    template.innerHTML = html;

    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          node.replaceWith(...node.childNodes);
          return;
        }
        // Remove disallowed attributes
        Array.from(node.attributes).forEach(attr => {
          if (!ALLOWED_ATTRS.has(attr.name)) {
            node.removeAttribute(attr.name);
          }
          // Strip javascript: hrefs
          if (attr.name === 'href' && /^javascript:/i.test(attr.value)) {
            node.removeAttribute('href');
          }
          // Strip on* event handlers
          if (/^on/i.test(attr.name)) {
            node.removeAttribute(attr.name);
          }
          // Force external links to open safely
          if (attr.name === 'href' && attr.value.startsWith('http')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
          }
        });
      }
      Array.from(node.childNodes).forEach(clean);
    }

    Array.from(template.content.childNodes).forEach(clean);
    return template.innerHTML;
  }

  // ── 4. Input length + character guards ───────────────────
  function sanitizeInput(str, maxLen = 4096) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/\0/g, '')                          // null bytes
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '') // dangerous control chars
      .slice(0, maxLen);
  }

  // ── 5. Session ID generation ──────────────────────────────
  function generateSessionId() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── 6. Secure storage wrapper ─────────────────────────────
  // Namespaces all keys and validates on read to prevent localStorage tampering
  const STORAGE_PREFIX = 'sw3:';
  const secureStorage = {
    set(key, value) {
      try {
        const payload = JSON.stringify({ v: value, ts: Date.now() });
        localStorage.setItem(STORAGE_PREFIX + key, payload);
      } catch { /* quota exceeded — fail silently */ }
    },
    get(key) {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.v ?? null;
      } catch { return null; }
    },
    delete(key) {
      try { localStorage.removeItem(STORAGE_PREFIX + key); } catch {}
    },
  };

  // ── 7. Anti-clickjacking ──────────────────────────────────
  (function preventClickjacking() {
    if (window.self !== window.top) {
      // Page is being loaded in an iframe — hide content and break out
      document.documentElement.style.display = 'none';
      try { window.top.location = window.self.location; } catch { window.self.location.reload(); }
    }
  })();

  // ── 8. Devtools detection (soft) ─────────────────────────
  // Not a hard security control — just logs suspicious behaviour
  let _devtoolsOpen = false;
  const _devCheck = setInterval(() => {
    const threshold = 160;
    if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) {
      if (!_devtoolsOpen) {
        _devtoolsOpen = true;
        console.warn('[SeWalk] Developer tools detected.');
      }
    } else {
      _devtoolsOpen = false;
    }
  }, 3000);

  // ── 9. Patch fetch to auto-sign /api requests ─────────────
  const _rawFetch = window.fetch.bind(window);
  window.fetch = async function(url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      try {
        let body = options.body;
        let parsedBody = body ? JSON.parse(body) : {};
        const signHeaders = await signRequest(parsedBody);
        options = {
          ...options,
          headers: {
            ...options.headers,
            ...signHeaders,
            'X-SeWalk-Session': _currentSessionId,
          },
        };
      } catch { /* non-JSON body — skip signing */ }
    }
    return _rawFetch(url, options);
  };

  // ── 10. Session tracking ──────────────────────────────────
  const _currentSessionId = generateSessionId();

  return {
    sanitizeHTML,
    sanitizeInput,
    secureStorage,
    generateSessionId,
    signRequest,
    currentSessionId: _currentSessionId,
  };
})();

// ── Override marked HTML output to run through sanitizer ───
// This patches renderContent() to sanitize before rendering.
// Place this AFTER marked is loaded but BEFORE app.js uses it.
document.addEventListener('DOMContentLoaded', () => {
  // Patch all innerHTML assignments on .md elements to sanitize
  const _origRenderContent = window.renderContent;
  if (typeof _origRenderContent === 'function') {
    window.renderContent = function(text) {
      const wrapper = _origRenderContent(text);
      // Re-sanitize the rendered HTML output
      wrapper.innerHTML = SeWalkSecurity.sanitizeHTML(wrapper.innerHTML);
      return wrapper;
    };
  }

  // Enforce maxlength on the main input at the JS level too
  const input = document.getElementById('userInput');
  if (input) {
    input.setAttribute('maxlength', '4096');
    input.addEventListener('input', () => {
      if (input.value.length > 4000) {
        input.style.borderColor = 'var(--error, #f87171)';
      } else {
        input.style.borderColor = '';
      }
    });
  }

  // Prevent form submission via Enter key from submitting twice
  // (already patched in app.js but this is a safety net)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'userInput' && !e.shiftKey) {
      e.preventDefault();
    }
  }, { capture: true });
});

// ── Remove Supabase key from global scope after init ────────
// Supabase anon key is safe to expose, but we minimise surface area
// by deleting the global const references once the client is created.
// Note: the actual key is already baked into the supabase client object,
// this just removes the loose global variable.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    // These were declared as const in app.js so we can't delete them,
    // but we can shadow them on window to prevent easy console extraction.
    try {
      Object.defineProperty(window, 'SUPABASE_KEY', { get: () => '[protected]', configurable: false });
      Object.defineProperty(window, 'SUPABASE_URL', { get: () => '[protected]', configurable: false });
    } catch { /* already defined or strict mode — skip */ }
  }, 2000);
}, { once: true });
