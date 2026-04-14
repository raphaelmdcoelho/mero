const { verifyAccess } = require('../auth');
const { db } = require('../db');

function protect(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyAccess(token);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }

  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.user.userId);
  if (!exists) {
    return res.status(401).json({ error: 'User no longer exists' });
  }

  next();
}

module.exports = protect;
