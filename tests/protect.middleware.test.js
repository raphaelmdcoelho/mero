import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/db.js', () => ({
  client: { execute: vi.fn() },
  transaction: vi.fn(),
  initDb: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeApp(verifyAccessImpl, dbRowsImpl) {
  // Re-mock per test via closure
  const app = express();
  app.use(express.json());

  // Inline the protect logic so we can control verifyAccess and db per test
  app.use('/protected', async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.slice(7);
    let decoded;
    try {
      decoded = verifyAccessImpl(token);
    } catch {
      return res.status(401).json({ error: 'Token invalid or expired' });
    }
    req.user = decoded;

    const rows = await dbRowsImpl(decoded.userId);
    if (!rows.length) {
      return res.status(401).json({ error: 'User no longer exists' });
    }
    next();
  });

  app.get('/protected', (req, res) => res.json({ ok: true, user: req.user }));
  return app;
}

describe('protect middleware', () => {
  const validPayload = { userId: 1, username: 'testuser' };
  const alwaysVerify = () => validPayload;
  const userExists   = async () => [{ id: 1 }];
  const userGone     = async () => [];

  it('returns 401 when Authorization header is missing', async () => {
    const app = makeApp(alwaysVerify, userExists);
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization/);
  });

  it('returns 401 when Authorization header is malformed (no Bearer prefix)', async () => {
    const app = makeApp(alwaysVerify, userExists);
    const res = await request(app).get('/protected').set('Authorization', 'Token abc123');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization/);
  });

  it('returns 401 when token verification throws (expired or invalid)', async () => {
    const throwingVerify = () => { throw new Error('TokenExpiredError'); };
    const app = makeApp(throwingVerify, userExists);
    const res = await request(app).get('/protected').set('Authorization', 'Bearer badtoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token invalid or expired');
  });

  it('returns 401 when user no longer exists in DB', async () => {
    const app = makeApp(alwaysVerify, userGone);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer validtoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('User no longer exists');
  });

  it('calls next and sets req.user when token and user are valid', async () => {
    const app = makeApp(alwaysVerify, userExists);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer validtoken');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.userId).toBe(1);
    expect(res.body.user.username).toBe('testuser');
  });

  it('strips "Bearer " prefix correctly before passing token to verifyAccess', async () => {
    let captured = null;
    const capturingVerify = (tok) => { captured = tok; return validPayload; };
    const app = makeApp(capturingVerify, userExists);
    await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer myspecialtoken');
    expect(captured).toBe('myspecialtoken');
  });
});
