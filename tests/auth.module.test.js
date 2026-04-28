import { describe, it, expect, beforeAll } from 'vitest';

// Set env vars before requiring the module
beforeAll(() => {
  process.env.JWT_SECRET = 'test-access-secret-1234567890';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0987654321';
});

// Dynamic import after env is set
async function getAuth() {
  // Clear module cache so env vars are picked up
  const mod = await import('../../server/auth.js');
  return mod;
}

describe('auth module', () => {
  it('signAccess returns a string token', async () => {
    const { signAccess } = await getAuth();
    const token = signAccess({ userId: 1, username: 'alice' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT has 3 parts
  });

  it('signRefresh returns a string token', async () => {
    const { signRefresh } = await getAuth();
    const token = signRefresh({ userId: 1, username: 'alice' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('verifyAccess decodes a valid access token', async () => {
    const { signAccess, verifyAccess } = await getAuth();
    const payload = { userId: 42, username: 'bob' };
    const token = signAccess(payload);
    const decoded = verifyAccess(token);
    expect(decoded.userId).toBe(42);
    expect(decoded.username).toBe('bob');
  });

  it('verifyRefresh decodes a valid refresh token', async () => {
    const { signRefresh, verifyRefresh } = await getAuth();
    const payload = { userId: 7, username: 'carol' };
    const token = signRefresh(payload);
    const decoded = verifyRefresh(token);
    expect(decoded.userId).toBe(7);
    expect(decoded.username).toBe('carol');
  });

  it('verifyAccess throws when given a refresh token (wrong secret)', async () => {
    const { signRefresh, verifyAccess } = await getAuth();
    const token = signRefresh({ userId: 1, username: 'alice' });
    expect(() => verifyAccess(token)).toThrow();
  });

  it('verifyRefresh throws when given an access token (wrong secret)', async () => {
    const { signAccess, verifyRefresh } = await getAuth();
    const token = signAccess({ userId: 1, username: 'alice' });
    expect(() => verifyRefresh(token)).toThrow();
  });

  it('verifyAccess throws on a tampered token', async () => {
    const { signAccess, verifyAccess } = await getAuth();
    const token = signAccess({ userId: 1, username: 'alice' });
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyAccess(tampered)).toThrow();
  });

  it('verifyAccess throws on a completely invalid string', async () => {
    const { verifyAccess } = await getAuth();
    expect(() => verifyAccess('not.a.token')).toThrow();
  });
});
