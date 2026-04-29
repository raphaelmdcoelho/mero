import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ── Patch protect middleware ───────────────────────────────────────────────────

const protectPath = require.resolve('../../server/middleware/protect.js');
require.cache[protectPath] = {
  id: protectPath, filename: protectPath, loaded: true,
  exports: (req, _res, next) => { req.user = { userId: 1, username: 'testuser' }; next(); },
};

// ── Pre-load shared modules ───────────────────────────────────────────────────

const db = require('../../server/db.js');
const router = require('../../server/routes/farm.js');

// ── App ───────────────────────────────────────────────────────────────────────

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use('/api/farm', router);
  return a;
})();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseChar = { id: 10, user_id: 1, level: 5 };

// ── Spies ─────────────────────────────────────────────────────────────────────

let executeSpy;

beforeEach(() => {
  executeSpy = vi.spyOn(db.client, 'execute');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── GET /api/farm/:characterId ────────────────────────────────────────────────

describe('GET /api/farm/:characterId', () => {
  it('returns 404 if character does not belong to user', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(404);
  });

  it('returns farmQueue array', async () => {
    const queueItem = { id: 1, plant_type: 'carrot', ready_at: 9999999999, remaining_seconds: 300 };
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] })            // harvestReady: nothing ready
      .mockResolvedValueOnce({ rows: [queueItem] });  // farmStatus
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.farmQueue)).toBe(true);
    expect(res.body.farmQueue[0].plant_type).toBe('carrot');
  });

  it('auto-harvests ready items on GET (side effect)', async () => {
    const readyItem = { id: 2, character_id: 10, plant_type: 'apple', remaining_seconds: 0 };
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [readyItem] })  // harvestReady: one ready
      .mockResolvedValueOnce({ rows: [] })            // existing inventory check
      .mockResolvedValueOnce({})                       // INSERT inventory
      .mockResolvedValueOnce({})                       // DELETE farm_queue
      .mockResolvedValueOnce({ rows: [] });            // farmStatus: now empty
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(200);
    const deleteCalls = executeSpy.mock.calls.filter(c =>
      c[0]?.sql?.includes('DELETE FROM farm_queue')
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });
});

// ── POST /api/farm/:characterId/grow ──────────────────────────────────────────

describe('POST /api/farm/:characterId/grow', () => {
  it('returns 404 if character not found', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'carrot' });
    expect(res.status).toBe(404);
  });

  it('returns 403 if character level < 3', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, level: 2 }] });
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'carrot' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/level 3/);
  });

  it('returns 400 for an invalid plant_type', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'corn' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/carrot.*apple/);
  });

  it('queues a carrot successfully and returns farmQueue', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({})                     // INSERT farm_queue
      .mockResolvedValueOnce({ rows: [] })            // harvestReady
      .mockResolvedValueOnce({ rows: [
        { id: 3, plant_type: 'carrot', ready_at: 9999999, remaining_seconds: 540 },
      ] });
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'carrot' });
    expect(res.status).toBe(200);
    expect(res.body.farmQueue[0].plant_type).toBe('carrot');
  });

  it('queues an apple (shorter grow time) successfully', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { id: 4, plant_type: 'apple', ready_at: 9999999, remaining_seconds: 300 },
      ] });
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'apple' });
    expect(res.status).toBe(200);
    expect(res.body.farmQueue[0].plant_type).toBe('apple');
  });
});
