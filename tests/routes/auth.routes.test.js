import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

// ── Pre-load shared modules to get stable object references ──────────────────

const db   = require('../../server/db.js');
const auth = require('../../server/auth.js');
const bcrypt = require('bcryptjs');

// ── Patch protect middleware into require cache ───────────────────────────────
// protect.js is loaded by auth routes — replace with pass-through (auth routes don't use protect)

// ── Load route module ─────────────────────────────────────────────────────────

const authRouter = require('../../server/routes/auth.js');

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

// ── Spies ─────────────────────────────────────────────────────────────────────

let executeSpy, bcryptHashSpy, bcryptCompareSpy;

beforeEach(() => {
  executeSpy        = vi.spyOn(db.client, 'execute');
  bcryptHashSpy     = vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-password');
  bcryptCompareSpy  = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const app = buildApp();

// ── Register ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('returns 400 if username is too short (< 3 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Username/);
  });

  it('returns 400 if username is too long (> 20 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'a'.repeat(21), password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Username/);
  });

  it('returns 400 if username contains special characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'user@name', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Username/);
  });

  it('returns 400 if password is shorter than 6 chars', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] }); // no existing user check
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Password/);
  });

  it('returns 409 if username is already taken', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // username exists
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/);
  });

  it('returns 200 with accessToken and username on success', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [] })               // no existing user
      .mockResolvedValueOnce({ lastInsertRowid: 5n });   // insert result
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: 'securepass' });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(10);
    expect(res.body.username).toBe('newuser');
  });

  it('sets a refreshToken cookie on successful registration', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ lastInsertRowid: 5n });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: 'securepass' });
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('refreshToken='))).toBe(true);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 400 if username or password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice' });
    expect(res.status).toBe(400);
  });

  it('returns 401 if user is not found', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns 401 if password does not match', async () => {
    executeSpy.mockResolvedValueOnce({
      rows: [{ id: 1, username: 'alice', password: 'hashed' }],
    });
    bcryptCompareSpy.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns accessToken and username on successful login', async () => {
    executeSpy.mockResolvedValueOnce({
      rows: [{ id: 1, username: 'alice', password: 'hashed' }],
    });
    bcryptCompareSpy.mockResolvedValueOnce(true);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'correctpass' });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(10);
    expect(res.body.username).toBe('alice');
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('returns 401 when no refreshToken cookie is present', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No refresh token');
  });

  it('returns 401 when refresh token is invalid or expired', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=this.is.not.a.valid.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Refresh token invalid or expired');
  });

  it('returns a new accessToken on valid refresh', async () => {
    // Generate a real refresh token using the test JWT_REFRESH_SECRET from setup.js
    const validToken = auth.signRefresh({ userId: 1, username: 'alice' });
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${validToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(10);
  });

  it('rotates the refresh cookie on successful refresh', async () => {
    const validToken = auth.signRefresh({ userId: 1, username: 'alice' });
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${validToken}`);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('refreshToken='))).toBe(true);
  });
});

// ── Logout ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns { ok: true } without requiring auth', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('clears the refreshToken cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=sometoken');
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('refreshToken='))).toBe(true);
  });
});
