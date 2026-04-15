'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { client } = require('../db');
const { signAccess, signRefresh, verifyRefresh } = require('../auth');

const router = express.Router();
const SALT_ROUNDS = 10;
const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9]{3,20}$/.test(u);
}

function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3–20 alphanumeric characters' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existR = await client.execute({
    sql:  'SELECT id FROM users WHERE username = ?',
    args: [username],
  });
  if (existR.rows.length) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await client.execute({
    sql:  'INSERT INTO users (username, password) VALUES (?, ?)',
    args: [username, hash],
  });
  const userId = Number(result.lastInsertRowid);

  const payload = { userId, username };
  res.cookie(REFRESH_COOKIE, signRefresh(payload), COOKIE_OPTS);
  res.json({ accessToken: signAccess(payload), username });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const userR = await client.execute({
    sql:  'SELECT id, username, password FROM users WHERE username = ?',
    args: [username],
  });
  const user = userR.rows[0] ?? null;
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = { userId: Number(user.id), username: user.username };
  res.cookie(REFRESH_COOKIE, signRefresh(payload), COOKIE_OPTS);
  res.json({ accessToken: signAccess(payload), username: user.username });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const token = req.cookies[REFRESH_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'No refresh token' });
  }
  try {
    const payload = verifyRefresh(token);
    const fresh = { userId: payload.userId, username: payload.username };
    res.cookie(REFRESH_COOKIE, signRefresh(fresh), COOKIE_OPTS);
    res.json({ accessToken: signAccess(fresh) });
  } catch {
    return res.status(401).json({ error: 'Refresh token invalid or expired' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(REFRESH_COOKIE);
  res.json({ ok: true });
});

module.exports = router;
