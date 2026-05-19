// DEV TOOL — not included in game build
// Usage: npm run canvas  →  http://localhost:3001
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = 3001;
const REPO     = path.join(__dirname, '..', '..');
const CSS_FILE = path.join(REPO, 'public', 'css', 'style.css');
const HTML_FILE = path.join(__dirname, 'index.html');

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ── CSS patcher ───────────────────────────────────────────────────────────────

// Replaces top/left/width/height values inside a specific CSS rule block.
// Handles both pre-existing properties (replaces value) and absent ones (inserts).
function patchRule(css, selector, values) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the exact selector block (not a prefix of a longer selector)
  const re = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`, '');
  if (!re.test(css)) return { css, patched: false };

  const patched = css.replace(re, (_m, open, body, close) => {
    let b = body;
    for (const [prop, val] of Object.entries(values)) {
      const propRe = new RegExp(`(${prop}\\s*:\\s*)([^;]+)(;)`, '');
      if (propRe.test(b)) {
        b = b.replace(propRe, `$1${val}$3`);
      } else {
        b = b.replace(/(\s*)$/, `\n  ${prop}: ${val};$1`);
      }
    }
    return open + b + close;
  });
  return { css: patched, patched: true };
}

// Map of overlay slot key → CSS selector
const SLOT_SELECTORS = {
  armor:          '.equip-overlay',
  'armor-f':      '.equip-overlay-armor--female',
  shield:         '.equip-overlay-shield',
  'shield-f':     '.equip-overlay-shield--female',
  boots:          '.equip-overlay-boots',
  'boots-f':      '.equip-overlay-boots--female',
  gauntlet:       '.equip-overlay-gauntlet',
  'gauntlet-f':   '.equip-overlay-gauntlet--female',
  helmet:         '.equip-overlay-helmet',
  'helmet-f':     '.equip-overlay-helmet--female',
};

function applyOverlaysToCss(css, overlays) {
  const results = [];
  for (const [key, selector] of Object.entries(SLOT_SELECTORS)) {
    const pos = overlays[key];
    if (!pos) continue;
    const values = {
      top:    parseFloat(pos.top).toFixed(2)    + '%',
      left:   parseFloat(pos.left).toFixed(2)   + '%',
      width:  parseFloat(pos.width).toFixed(2)  + '%',
      height: parseFloat(pos.height).toFixed(2) + '%',
    };
    const result = patchRule(css, selector, values);
    css = result.css;
    results.push({ key, selector, patched: result.patched });
  }
  return { css, results };
}

// ── Request handler ───────────────────────────────────────────────────────────

function serve(res, filePath, status = 200) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(status, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + filePath);
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' });
    return res.end();
  }

  // ── POST /apply ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/apply') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { overlays } = JSON.parse(body);
        if (!overlays || typeof overlays !== 'object') {
          return json(res, 400, { error: 'Missing overlays payload' });
        }
        const css = fs.readFileSync(CSS_FILE, 'utf8');
        const { css: patched, results } = applyOverlaysToCss(css, overlays);
        fs.writeFileSync(CSS_FILE, patched, 'utf8');
        const missed = results.filter(r => !r.patched).map(r => r.selector);
        json(res, 200, {
          ok: true,
          applied: results.filter(r => r.patched).length,
          missed,
          message: missed.length
            ? `Applied ${results.filter(r=>r.patched).length} rules. Could not find selectors: ${missed.join(', ')}`
            : `Applied ${results.filter(r=>r.patched).length} rules to style.css`,
        });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    });
    return;
  }

  // ── GET / ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (url === '/' || url === '/index.html') {
      return serve(res, HTML_FILE);
    }
    // Engine logo at repo root
    if (url === '/shedr.png') {
      return serve(res, path.join(REPO, 'shedr.png'));
    }
    // Serve public/ assets: /public/items/..., /public/avatars/..., etc.
    if (url.startsWith('/public/')) {
      return serve(res, path.join(REPO, url));
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Avatar Canvas ready at http://localhost:${PORT}\n`);
});
