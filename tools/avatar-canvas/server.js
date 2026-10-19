// DEV TOOL — not included in game build
// Usage: npm run canvas  →  http://localhost:3001
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = 3001;
const REPO     = path.join(__dirname, '..', '..');
const FIT_FILE  = path.join(REPO, 'public', 'data', 'avatar-fit.json');
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
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

// ── Fit data validation ───────────────────────────────────────────────────────

const REGIONS = ['head', 'torso', 'hands', 'feet', 'shield'];
const FIT_MODES = ['width', 'height', 'contain', 'cover'];
const num = v => typeof v === 'number' && Number.isFinite(v);

// Rejects a malformed payload before it can overwrite the file the game reads.
function validateFit(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['payload is not an object'];
  if (!d.rules || typeof d.rules !== 'object') errs.push('missing rules');
  else for (const [slot, r] of Object.entries(d.rules)) {
    if (!REGIONS.includes(r.region)) errs.push(`rules.${slot}.region invalid`);
    if (!FIT_MODES.includes(r.fit)) errs.push(`rules.${slot}.fit invalid`);
    if (!r.anchor || !num(r.anchor.x) || !num(r.anchor.y)) errs.push(`rules.${slot}.anchor invalid`);
    if (!num(r.scale) || r.scale <= 0) errs.push(`rules.${slot}.scale invalid`);
  }
  if (!d.avatars || typeof d.avatars !== 'object') errs.push('missing avatars');
  else for (const [key, lm] of Object.entries(d.avatars)) {
    for (const reg of REGIONS) {
      const b = lm[reg];
      if (!b || ![b.x, b.y, b.w, b.h].every(num) || b.w <= 0 || b.h <= 0) errs.push(`avatars.${key}.${reg} invalid`);
    }
  }
  if (!Array.isArray(d.items)) errs.push('items must be an array');
  if (!d.sprites || typeof d.sprites !== 'object') errs.push('missing sprites');
  else for (const [src, sp] of Object.entries(d.sprites)) {
    if (!num(sp.w) || !num(sp.h) || !Array.isArray(sp.box) || sp.box.length !== 4 || !sp.box.every(num)) errs.push(`sprites.${src} invalid`);
  }
  if (d.overrides && typeof d.overrides !== 'object') errs.push('overrides invalid');
  return errs;
}

// ── Request handler ───────────────────────────────────────────────────────────

function serve(res, filePath, status = 200) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(status, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
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

  // ── POST /save-fit ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/save-fit') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const errors = validateFit(payload);
        if (errors.length) return json(res, 400, { error: 'Invalid fit data', errors });
        fs.mkdirSync(path.dirname(FIT_FILE), { recursive: true });
        if (fs.existsSync(FIT_FILE)) fs.copyFileSync(FIT_FILE, FIT_FILE + '.bak');
        const tmp = FIT_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, FIT_FILE);
        json(res, 200, { ok: true, message: 'Saved public/data/avatar-fit.json (backup: avatar-fit.json.bak)' });
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
    // Prompt templates + builder (live next to index.html)
    if (url === '/prompts.json')       return serve(res, path.join(__dirname, 'prompts.json'));
    if (url === '/prompt-builder.js')  return serve(res, path.join(__dirname, 'prompt-builder.js'));
    // Engine logo (lives alongside index.html in the tool directory)
    if (url === '/shedr.png') {
      return serve(res, path.join(__dirname, 'shedr.png'));
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
