require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files — explicit MIME types to avoid Render/proxy stripping them
const MIME_TYPES = {
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (MIME_TYPES[ext]) res.setHeader('Content-Type', MIME_TYPES[ext]);
  },
}));

// API Routes
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/game',       require('./routes/game'));
app.use('/api/farm',       require('./routes/farm'));
app.use('/api/market',     require('./routes/market'));

// SPA fallback — only for non-asset paths
app.get('*', (req, res) => {
  const ext = path.extname(req.path).toLowerCase();
  if (ext && ext !== '.html') {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mero server running at http://localhost:${PORT}`);
});
