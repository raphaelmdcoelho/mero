// Global test setup — runs before any test file imports modules.
// Sets env vars required by server/db.js so createClient() doesn't throw at import time.
process.env.TURSO_URL = 'libsql://test.example.com';
process.env.TURSO_AUTH_TOKEN = 'test-token';
process.env.JWT_SECRET = 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0987654321';
process.env.NODE_ENV = 'test';
