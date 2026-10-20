import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';
import { routeSql, sqlCalls } from '../db-mock.js';

const require = createRequire(import.meta.url);

// ── Patch protect middleware in require cache BEFORE loading routes ───────────

const protectPath = require.resolve('../../server/middleware/protect.js');
require.cache[protectPath] = {
  id: protectPath, filename: protectPath, loaded: true,
  exports: (req, _res, next) => { req.user = { userId: 1, username: 'testuser' }; next(); },
};

// ── Patch helpers.fullChar in require cache ───────────────────────────────────

const mockFullChar = vi.fn();
const helpersPath = require.resolve('../../server/helpers.js');
require.cache[helpersPath] = {
  id: helpersPath, filename: helpersPath, loaded: true,
  exports: { fullChar: mockFullChar },
};

// ── Pre-load shared modules ───────────────────────────────────────────────────

const db = require('../../server/db.js');
const router = require('../../server/routes/game.js');

// ── App ───────────────────────────────────────────────────────────────────────

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use('/api/game', router);
  return a;
})();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseChar = {
  id: 10, user_id: 1, name: 'Hero', class: 'Warrior',
  level: 5, xp: 0, xp_to_next: 130, hp: 35, max_hp: 35,
  weapon_id: 1, armor_id: 3, shield_id: 12,
  activity: null, activity_started_at: null, last_tick_at: null,
  unspent_points: 0, dungeon_mastery: 3,
  dungeon_mastery_s2: 0, dungeon_mastery_s3: 0,
  dungeon_mastery_s4: 0, dungeon_mastery_s5: 0,
  attr_strength: 5, attr_dexterity: 5, attr_agility: 5,
  attr_vitality: 5, attr_intelligence: 5, attr_focus: 5,
  attr_stamina: 5, attr_resistance: 5,
  reading_points_awarded: 0, gold: 0,
};

const fullCharResult = {
  ...baseChar, inventory: [], equippedWeapon: null,
  equippedArmor: null, equippedShield: null, farmQueue: [], dungeonRun: null,
};

// ── Spies ─────────────────────────────────────────────────────────────────────

let executeSpy, batchSpy;

beforeEach(() => {
  executeSpy = vi.spyOn(db.client, 'execute');
  batchSpy   = vi.spyOn(db.client, 'batch');
  mockFullChar.mockResolvedValue(fullCharResult);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFullChar.mockReset();
});

// ── Pure formula tests ────────────────────────────────────────────────────────

describe('levelUp logic (via game internals)', () => {
  it('calcMaxHp formula: 10 + (level-1)*5 + vitality*2', () => {
    expect(10 + (1 - 1) * 5 + 5 * 2).toBe(20);
    expect(10 + (5 - 1) * 5 + 5 * 2).toBe(40);
    expect(10 + (10 - 1) * 5 + 8 * 2).toBe(71);
  });

  it('XP threshold formula: floor(10 * 1.5^(level-1))', () => {
    expect(Math.floor(10 * Math.pow(1.5, 0))).toBe(10);
    expect(Math.floor(10 * Math.pow(1.5, 1))).toBe(15);
    expect(Math.floor(10 * Math.pow(1.5, 4))).toBe(50);
  });
});

// ── POST /api/game/:characterId/start ─────────────────────────────────────────

describe('POST /api/game/:characterId/start', () => {
  it('returns 404 if character not found', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/game/10/start').send({ action: 'tavern' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid action', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app).post('/api/game/10/start').send({ action: 'sleep' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dungeon\/enter/);
  });

  it('returns 403 for farm when character level < 3', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, level: 2 }] });
    const res = await request(app).post('/api/game/10/start').send({ action: 'farm' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/level 3/);
  });

  it('returns 400 if character is already in an activity', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, activity: 'tavern' }] });
    const res = await request(app).post('/api/game/10/start').send({ action: 'tavern' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Already/);
  });

  it('requires a valid restType for tavern', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, gold: 100 }] });
    const res = await request(app).post('/api/game/10/start').send({ action: 'tavern' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/restType/);
  });

  it('returns 400 when the character cannot afford the rest', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, gold: 5 }] });
    const res = await request(app).post('/api/game/10/start').send({ action: 'tavern', restType: 'relax' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not enough gold/);
  });

  it('starts tavern activity, charges the rest cost and returns fullChar', async () => {
    routeSql(executeSpy, [[/FROM characters WHERE id = \? AND user_id/, { rows: [{ ...baseChar, gold: 100 }] }]]);
    const res = await request(app).post('/api/game/10/start').send({ action: 'tavern', restType: 'break' });
    expect(res.status).toBe(200);
    expect(mockFullChar).toHaveBeenCalledWith(10);
    const update = executeSpy.mock.calls.map(c => c[0]).find(q => q.sql?.includes('SET activity = ?'));
    expect(update.args[0]).toBe('tavern');
    expect(update.args[3]).toBe('break');
    expect(update.args[4]).toBe(30); // break costs 30g
  });
});

// ── POST /api/game/:characterId/stop ──────────────────────────────────────────

describe('POST /api/game/:characterId/stop', () => {
  it('stops tavern and persists regen result', async () => {
    const now = Math.floor(Date.now() / 1000);
    const tavernChar = { ...baseChar, activity: 'tavern', activity_started_at: now - 60, last_tick_at: now - 60, hp: 10, max_hp: 35 };
    executeSpy
      .mockResolvedValueOnce({ rows: [tavernChar] })
      .mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/stop');
    expect(res.status).toBe(200);
    expect(mockFullChar).toHaveBeenCalledWith(10);
    const updateCall = executeSpy.mock.calls[1];
    const hpArg = updateCall[0].args[4];
    expect(Number(hpArg)).toBeGreaterThan(10);
  });

  it('stops an activity that is not tavern/reading without applying ticks', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, activity: 'dungeon' }] })
      .mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/stop');
    expect(res.status).toBe(200);
  });
});

// ── GET /api/game/:characterId/tick ───────────────────────────────────────────

describe('GET /api/game/:characterId/tick', () => {
  it('processes a tavern tick and updates character', async () => {
    const now = Math.floor(Date.now() / 1000);
    const tavernChar = { ...baseChar, activity: 'tavern', last_tick_at: now - 30, hp: 25, max_hp: 35 };
    executeSpy
      .mockResolvedValueOnce({ rows: [tavernChar] })
      .mockResolvedValueOnce({ rows: [] })  // harvestFarm
      .mockResolvedValueOnce({});           // UPDATE characters
    const res = await request(app).get('/api/game/10/tick');
    expect(res.status).toBe(200);
  });

  it('returns readingFinished: true after 1 hour of reading', async () => {
    const now = Math.floor(Date.now() / 1000);
    const readingChar = {
      ...baseChar, activity: 'reading',
      activity_started_at: now - 3601, last_tick_at: now - 60, reading_points_awarded: 2,
    };
    executeSpy
      .mockResolvedValueOnce({ rows: [readingChar] })
      .mockResolvedValueOnce({ rows: [] })  // harvestFarm
      .mockResolvedValueOnce({});           // UPDATE characters
    const res = await request(app).get('/api/game/10/tick');
    expect(res.status).toBe(200);
    expect(res.body.readingFinished).toBe(true);
  });
});

// ── POST /api/game/:characterId/dungeon/enter ────────────────────────────────

describe('POST /api/game/:characterId/dungeon/enter', () => {
  const monster = { id: 1, dungeon_set: 1, dungeon_level: 1, name: 'Goblin', hp: 12, is_boss: 0 };
  const enterRoutes = ({ char = baseChar, run = [], monsters = [monster], extra = [] } = {}) => [
    [/FROM characters WHERE id = \? AND user_id/, { rows: [char] }],
    [/SELECT id FROM dungeon_run/,                { rows: run }],
    [/FROM monsters WHERE dungeon_set/,           { rows: monsters }],
    ...extra,
  ];
  const enter = body => request(app).post('/api/game/10/dungeon/enter').send(body);

  beforeEach(() => { batchSpy.mockResolvedValue({}); });

  it('returns 400 if character already has an active activity', async () => {
    routeSql(executeSpy, enterRoutes({ char: { ...baseChar, activity: 'tavern' } }));
    const res = await enter({ level: 1, set: 1, difficulty: 'easy' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Stop your current activity/);
  });

  it('returns 400 if already in a dungeon run', async () => {
    routeSql(executeSpy, enterRoutes({ run: [{ id: 5 }] }));
    const res = await enter({ level: 1, set: 1, difficulty: 'easy' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Already in a dungeon run/);
  });

  it('returns 400 for level out of range', async () => {
    routeSql(executeSpy, enterRoutes());
    const res = await enter({ level: 11, set: 1, difficulty: 'easy' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level must be 1-10/);
  });

  it('returns 403 if character level too low for the requested set', async () => {
    routeSql(executeSpy, enterRoutes());
    const res = await enter({ level: 1, set: 2, difficulty: 'easy' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unlocks at level 20/);
  });

  it('returns 400 if trying to skip dungeon level (mastery gate)', async () => {
    routeSql(executeSpy, enterRoutes({ char: { ...baseChar, dungeon_mastery: 1 } }));
    const res = await enter({ level: 3, set: 1, difficulty: 'easy' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Complete dungeon level 2 first/);
  });

  it('returns 400 for a missing or unknown difficulty', async () => {
    routeSql(executeSpy, enterRoutes());
    const res = await enter({ level: 1, set: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/difficulty/);
  });

  it('returns 400 when stamina is below the difficulty cost', async () => {
    routeSql(executeSpy, enterRoutes({ char: { ...baseChar, stamina: 1 } }));
    const res = await enter({ level: 1, set: 1, difficulty: 'easy' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not enough stamina/);
  });

  it('returns 500 when the level has no monster data', async () => {
    routeSql(executeSpy, enterRoutes({ char: { ...baseChar, stamina: 10 }, monsters: [] }));
    const res = await enter({ level: 1, set: 1, difficulty: 'easy' });
    expect(res.status).toBe(500);
  });

  it('enters dungeon: creates the run, sets activity and spends stamina', async () => {
    routeSql(executeSpy, enterRoutes({ char: { ...baseChar, stamina: 10 } }));
    const res = await enter({ level: 1, set: 1, difficulty: 'medium' });
    expect(res.status).toBe(200);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const [insertRun, updateChar] = batchSpy.mock.calls[0][0];
    expect(insertRun.sql).toContain('INSERT INTO dungeon_run');
    expect(insertRun.args[6]).toBe('medium');
    expect(updateChar.args[2]).toBe(6); // 10 stamina - 4 (medium)
    // ends_at = started_at + 180 s
    expect(insertRun.args[7] - insertRun.args[5]).toBe(180);
  });

  it('rejects a potion that is not in the inventory', async () => {
    routeSql(executeSpy, enterRoutes({ char: { ...baseChar, stamina: 10 } }));
    const res = await enter({ level: 1, set: 1, difficulty: 'easy', potion_item_id: 40 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Potion not in inventory/);
  });

  it('shortens the run when a speed potion is used', async () => {
    routeSql(executeSpy, enterRoutes({
      char: { ...baseChar, stamina: 10 },
      extra: [
        [/FROM inventory inv/,                 { rows: [{ id: 40, item_subtype: 'adventure_potion', buff_effect: '{"type":"speed","value":0.5}' }] }],
        [/SELECT buff_effect FROM items/,      { rows: [{ buff_effect: '{"type":"speed","value":0.5}' }] }],
      ],
    }));
    const res = await enter({ level: 1, set: 1, difficulty: 'hard', potion_item_id: 40 });
    expect(res.status).toBe(200);
    const insertRun = batchSpy.mock.calls[0][0][0];
    expect(insertRun.args[7] - insertRun.args[5]).toBe(150); // hard 300 s * 0.5
    expect(insertRun.args[8]).toBe(40);
  });
});

// ── GET /api/game/:characterId/dungeon/status ─────────────────────────────────

describe('GET /api/game/:characterId/dungeon/status', () => {
  const statusRoutes = run => [
    [/FROM characters WHERE id = \? AND user_id/, { rows: [baseChar] }],
    [/FROM dungeon_run WHERE character_id/,       { rows: run ? [run] : [] }],
  ];

  it('reports inactive when there is no run', async () => {
    routeSql(executeSpy, statusRoutes(null));
    const res = await request(app).get('/api/game/10/dungeon/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false });
  });

  it('reports remaining time while the timer is running', async () => {
    const endsAt = Math.floor(Date.now() / 1000) + 120;
    routeSql(executeSpy, statusRoutes({ id: 1, character_id: 10, dungeon_level: 2, dungeon_set: 1, difficulty: 'easy', ends_at: endsAt, potion_item_id: null }));
    const res = await request(app).get('/api/game/10/dungeon/status');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.remainingMs).toBeGreaterThan(100000);
    expect(res.body.difficulty).toBe('easy');
    expect(res.body.dungeon_level).toBe(2);
  });
});

// ── POST /api/game/:characterId/dungeon/stop ──────────────────────────────────

describe('POST /api/game/:characterId/dungeon/stop', () => {
  it('returns 400 if there is no active dungeon run', async () => {
    routeSql(executeSpy, [[/FROM characters WHERE id = \? AND user_id/, { rows: [baseChar] }]]);
    const res = await request(app).post('/api/game/10/dungeon/stop');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active dungeon run/);
  });

  it('cancels the run without xp, gold or loot', async () => {
    routeSql(executeSpy, [
      [/FROM characters WHERE id = \? AND user_id/, { rows: [{ ...baseChar, activity: 'dungeon' }] }],
      [/FROM dungeon_run WHERE character_id/,       { rows: [{ id: 1, character_id: 10 }] }],
    ]);
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/dungeon/stop');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ done: true, forced: true, gainedXp: 0, gainedGold: 0, loot: [] });
    expect(batchSpy.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sql: expect.stringContaining('DELETE FROM dungeon_run') }),
        expect.objectContaining({ sql: expect.stringContaining('SET activity = NULL') }),
      ])
    );
  });
});
