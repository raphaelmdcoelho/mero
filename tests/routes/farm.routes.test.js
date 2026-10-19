import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';
import { routeSql, sqlCalls } from '../db-mock.js';

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

// Farm status = harvestReady() + queue + farm level/xp. Routes answer by SQL.
const farmRoutes = ({ char = baseChar, ready = [], queue = [], farm = { farm_level: 1, farm_xp: 0 }, inventory = [] } = {}) => [
  [/FROM characters WHERE id = \? AND user_id/, { rows: [char] }],
  [/FROM farm_queue WHERE character_id = \? AND ready_at/, { rows: ready }],
  [/SELECT id FROM inventory/, { rows: inventory }],
  [/SELECT id, plant_type, ready_at/, { rows: queue }],
  [/SELECT farm_level, farm_xp FROM characters/, { rows: [farm] }],
];

// ── GET /api/farm/:characterId ────────────────────────────────────────────────

describe('GET /api/farm/:characterId', () => {
  it('returns 404 if character does not belong to user', async () => {
    routeSql(executeSpy, [[/FROM characters WHERE id = \? AND user_id/, { rows: [] }]]);
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(404);
  });

  it('returns farmQueue array with farm level info', async () => {
    const queueItem = { id: 1, plant_type: 'carrot', ready_at: 9999999999, remaining_seconds: 300 };
    routeSql(executeSpy, farmRoutes({ queue: [queueItem], farm: { farm_level: 3, farm_xp: 4 } }));
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.farmQueue)).toBe(true);
    expect(res.body.farmQueue[0].plant_type).toBe('carrot');
    expect(res.body.farmLevel).toBe(3);
    expect(res.body.farmXp).toBe(4);
    expect(res.body.farmXpToNext).toBe(15);
  });

  it('auto-harvests ready items on GET (side effect)', async () => {
    const readyItem = { id: 2, character_id: 10, plant_type: 'apple' };
    routeSql(executeSpy, farmRoutes({ ready: [readyItem] }));
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(200);
    const calls = sqlCalls(executeSpy);
    expect(calls.some(q => q.includes('INSERT INTO inventory'))).toBe(true);
    expect(calls.some(q => q.includes('DELETE FROM farm_queue'))).toBe(true);
    expect(calls.some(q => q.includes('UPDATE characters SET farm_level'))).toBe(true);
  });

  it('stacks a harvested plant onto an existing inventory row', async () => {
    const readyItem = { id: 2, character_id: 10, plant_type: 'carrot' };
    routeSql(executeSpy, farmRoutes({ ready: [readyItem], inventory: [{ id: 77 }] }));
    const res = await request(app).get('/api/farm/10');
    expect(res.status).toBe(200);
    const calls = sqlCalls(executeSpy);
    expect(calls.some(q => q.includes('UPDATE inventory SET quantity'))).toBe(true);
    expect(calls.some(q => q.includes('INSERT INTO inventory'))).toBe(false);
  });

  it('levels the farm up when harvest xp reaches the threshold', async () => {
    const readyItem = { id: 2, character_id: 10, plant_type: 'carrot' };
    routeSql(executeSpy, farmRoutes({ ready: [readyItem], farm: { farm_level: 1, farm_xp: 4 } }));
    await request(app).get('/api/farm/10');
    const update = executeSpy.mock.calls.map(c => c[0]).find(q => q.sql?.includes('UPDATE characters SET farm_level'));
    // level 1 needs 5 xp: 4 + 1 harvested = 5 -> level 2 with 0 xp left
    expect(update.args.slice(0, 2)).toEqual([2, 0]);
  });
});

// ── POST /api/farm/:characterId/grow ──────────────────────────────────────────

describe('POST /api/farm/:characterId/grow', () => {
  it('returns 404 if character not found', async () => {
    routeSql(executeSpy, [[/FROM characters WHERE id = \? AND user_id/, { rows: [] }]]);
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'carrot' });
    expect(res.status).toBe(404);
  });

  it('returns 403 if character level < 3', async () => {
    routeSql(executeSpy, farmRoutes({ char: { ...baseChar, level: 2 } }));
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'carrot' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/level 3/);
  });

  it('returns 400 for an invalid plant_type', async () => {
    routeSql(executeSpy, farmRoutes());
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid plant_type/);
  });

  it.each(['carrot', 'apple', 'onion', 'corn'])('queues %s and returns farmQueue', async (plant) => {
    const queued = { id: 3, plant_type: plant, ready_at: 9999999, remaining_seconds: 300 };
    routeSql(executeSpy, farmRoutes({ queue: [queued] }));
    const res = await request(app).post('/api/farm/10/grow').send({ plant_type: plant });
    expect(res.status).toBe(200);
    expect(res.body.farmQueue[0].plant_type).toBe(plant);
    const insert = executeSpy.mock.calls.map(c => c[0]).find(q => q.sql?.includes('INSERT INTO farm_queue'));
    expect(insert.args[1]).toBe(plant);
    expect(insert.args[3]).toBe(300);
  });
});

// ── POST /api/farm/:characterId/start ─────────────────────────────────────────

describe('POST /api/farm/:characterId/start', () => {
  it('rejects more plants than the farm level allows', async () => {
    routeSql(executeSpy, farmRoutes({ char: { ...baseChar, farm_level: 1 } }));
    const res = await request(app).post('/api/farm/10/start').send({ slots: ['carrot', 'apple'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Farm level 1/);
  });

  it('rejects an empty slots list', async () => {
    routeSql(executeSpy, farmRoutes());
    const res = await request(app).post('/api/farm/10/start').send({ slots: [null, ''] });
    expect(res.status).toBe(400);
  });

  it('replaces the queue and inserts one row per plant', async () => {
    routeSql(executeSpy, farmRoutes({ char: { ...baseChar, farm_level: 2 } }));
    const res = await request(app).post('/api/farm/10/start').send({ slots: ['carrot', null, 'corn'] });
    expect(res.status).toBe(200);
    expect(res.body.durationSeconds).toBe(300);
    const calls = sqlCalls(executeSpy);
    expect(calls.filter(q => q.includes('INSERT INTO farm_queue'))).toHaveLength(2);
    expect(calls.some(q => q.startsWith('DELETE FROM farm_queue WHERE character_id'))).toBe(true);
  });
});

// ── DELETE /api/farm/:characterId ─────────────────────────────────────────────

describe('DELETE /api/farm/:characterId', () => {
  it('cancels the grow session', async () => {
    routeSql(executeSpy, farmRoutes());
    const res = await request(app).delete('/api/farm/10');
    expect(res.status).toBe(200);
    expect(res.body.farmQueue).toEqual([]);
  });
});
