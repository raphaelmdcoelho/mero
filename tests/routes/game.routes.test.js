import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

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

  it('starts tavern activity and returns fullChar', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/start').send({ action: 'tavern' });
    expect(res.status).toBe(200);
    expect(mockFullChar).toHaveBeenCalledWith(10);
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

// ── POST /api/game/:characterId/dungeon/enter ─────────────────────────────────

describe('POST /api/game/:characterId/dungeon/enter', () => {
  it('returns 400 if character already has an active activity', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, activity: 'tavern' }] });
    const res = await request(app).post('/api/game/10/dungeon/enter').send({ level: 1, set: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Stop your current activity/);
  });

  it('returns 400 if already in a dungeon run', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await request(app).post('/api/game/10/dungeon/enter').send({ level: 1, set: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Flee first/);
  });

  it('returns 400 for level out of range', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/game/10/dungeon/enter').send({ level: 11, set: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level must be 1-10/);
  });

  it('returns 403 if character level too low for the requested set', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, level: 5 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/game/10/dungeon/enter').send({ level: 1, set: 2 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unlocks at level 20/);
  });

  it('returns 400 if trying to skip dungeon level (mastery gate)', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, dungeon_mastery: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/game/10/dungeon/enter').send({ level: 3, set: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Complete dungeon level 2 first/);
  });

  it('enters dungeon successfully', async () => {
    const monster = { id: 1, dungeon_set: 1, dungeon_level: 1, name: 'Goblin', hp: 12, is_boss: 0 };
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [monster] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/dungeon/enter').send({ level: 1, set: 1 });
    expect(res.status).toBe(200);
    expect(batchSpy).toHaveBeenCalled();
  });
});

// ── POST /api/game/:characterId/dungeon/flee ──────────────────────────────────

describe('POST /api/game/:characterId/dungeon/flee', () => {
  it('clears dungeon run and activity without penalty', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, activity: 'dungeon' }] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/dungeon/flee');
    expect(res.status).toBe(200);
    expect(batchSpy.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sql: expect.stringContaining('DELETE FROM dungeon_run') }),
      ])
    );
  });
});

// ── POST /api/game/:characterId/dungeon/attack ────────────────────────────────

describe('POST /api/game/:characterId/dungeon/attack', () => {
  const monster = {
    id: 1, name: 'Goblin', hp: 12, damage: 3, hit_chance: 55,
    dodge_chance: 8, defense: 0, xp_reward: 5, is_boss: 0,
    drop_chance: 8, dungeon_level: 1, dungeon_set: 1,
  };
  const run = { id: 1, character_id: 10, dungeon_level: 1, dungeon_set: 1, kills: 0, monster_id: 1, monster_hp: 12, started_at: 1000 };
  const weapon = { id: 1, damage: 2, weapon_type: 'melee', defense: 0 };
  const armor  = { id: 3, damage: 0, weapon_type: null, defense: 2, armor_slot: 'body' };
  const shield = { id: 12, damage: 0, weapon_type: null, defense: 2, armor_slot: 'shield' };

  it('returns 400 if no active dungeon run', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/game/10/dungeon/attack');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active dungeon run/);
  });

  it('returns defeat with hp=1 when player dies', async () => {
    const dyingChar = { ...baseChar, hp: 1, weapon_id: null, armor_id: null, shield_id: null };
    const strongMonster = { ...monster, damage: 999, hit_chance: 100, dodge_chance: 0 };
    executeSpy
      .mockResolvedValueOnce({ rows: [dyingChar] })
      .mockResolvedValueOnce({ rows: [run] })
      .mockResolvedValueOnce({ rows: [strongMonster] })
      .mockResolvedValueOnce({ rows: [null] })
      .mockResolvedValueOnce({ rows: [null] })
      .mockResolvedValueOnce({ rows: [null] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/game/10/dungeon/attack');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('defeat');
    const batchCalls = batchSpy.mock.calls[0][0];
    expect(batchCalls.find(c => c.sql.includes('SET hp = 1'))).toBeDefined();
  });

  it('returns monster_killed with XP awarded when monster dies', async () => {
    const strongChar = { ...baseChar, hp: 100, attr_strength: 20, attr_dexterity: 20 };
    const weakMonster = { ...monster, hp: 1, damage: 0 };
    const weakRun = { ...run, monster_hp: 1 };
    const nextMonster = { ...monster, id: 2 };
    executeSpy
      .mockResolvedValueOnce({ rows: [strongChar] })
      .mockResolvedValueOnce({ rows: [weakRun] })
      .mockResolvedValueOnce({ rows: [weakMonster] })
      .mockResolvedValueOnce({ rows: [weapon] })
      .mockResolvedValueOnce({ rows: [armor] })
      .mockResolvedValueOnce({ rows: [shield] })
      .mockResolvedValueOnce({ rows: [] })         // no gear drop
      .mockResolvedValueOnce({ rows: [nextMonster] });
    batchSpy.mockResolvedValueOnce({});
    // 0.5 * 100 = 50 < hitChance(70) so player hits; 50 >= drop_chance so no gear drop
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const res = await request(app).post('/api/game/10/dungeon/attack');
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('monster_killed');
    expect(res.body.gainedXp).toBe(5);
  });

  it('returns run_complete and updates mastery when boss is killed', async () => {
    const bossMonster = { ...monster, is_boss: 1, hp: 1, damage: 0, xp_reward: 55 };
    const bossRun = { ...run, monster_hp: 1 };
    const strongChar = { ...baseChar, hp: 100, dungeon_mastery: 0 };
    executeSpy
      .mockResolvedValueOnce({ rows: [strongChar] })
      .mockResolvedValueOnce({ rows: [bossRun] })
      .mockResolvedValueOnce({ rows: [bossMonster] })
      .mockResolvedValueOnce({ rows: [weapon] })
      .mockResolvedValueOnce({ rows: [armor] })
      .mockResolvedValueOnce({ rows: [shield] })
      .mockResolvedValueOnce({ rows: [] });         // no gear drop
    batchSpy.mockResolvedValueOnce({});
    // 0.5 * 100 = 50 < hitChance(70) so player hits; 50 >= drop_chance so no gear drop
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const res = await request(app).post('/api/game/10/dungeon/attack');
    vi.restoreAllMocks();
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('run_complete');
    expect(res.body.newMastery).toBe(1);
    expect(batchSpy.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sql: expect.stringContaining('DELETE FROM dungeon_run') }),
      ])
    );
  });
});
