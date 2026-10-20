import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';
import { routeSql, sqlCalls } from '../db-mock.js';

const require = createRequire(import.meta.url);

// ── Patch protect middleware in require cache BEFORE loading routes ───────────
// Inject req.user without touching DB or JWT

const protectPath = require.resolve('../../server/middleware/protect.js');
require.cache[protectPath] = {
  id: protectPath,
  filename: protectPath,
  loaded: true,
  exports: (req, _res, next) => { req.user = { userId: 1, username: 'testuser' }; next(); },
};

// ── Pre-load shared modules ───────────────────────────────────────────────────

const db = require('../../server/db.js');

// ── Load routes (after protect is patched) ────────────────────────────────────

const router = require('../../server/routes/characters.js');

// ── App factory ───────────────────────────────────────────────────────────────

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use('/api/characters', router);
  return a;
})();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseChar = {
  id: 10, user_id: 1, name: 'Hero', class: 'Warrior',
  level: 5, xp: 0, xp_to_next: 130, hp: 35, max_hp: 35,
  weapon_id: 1, armor_id: 3, shield_id: 12,
  avatar_path: null, activity: null, unspent_points: 0,
  attr_strength: 5, attr_dexterity: 5, attr_agility: 5,
  attr_vitality: 5, attr_intelligence: 5, attr_focus: 5,
  attr_stamina: 5, attr_resistance: 5,
};

const weapon = { id: 1, name: 'Wooden Sword', type: 'weapon', damage: 2, defense: 0, weapon_type: 'melee', armor_slot: null, sell_price: 5, icon: '🗡️', description: '' };
const armor  = { id: 3, name: 'Leather Armor', type: 'armor', damage: 0, defense: 2, weapon_type: null, armor_slot: 'body', sell_price: 10, icon: '🥋', description: '' };
const shield = { id: 12, name: 'Oak Shield', type: 'armor', damage: 0, defense: 2, weapon_type: null, armor_slot: 'shield', sell_price: 12, icon: '🪵', description: '' };

function mockEnrich(executeSpy) {
  executeSpy
    .mockResolvedValueOnce({ rows: [] })          // inventory
    .mockResolvedValueOnce({ rows: [weapon] })    // weapon
    .mockResolvedValueOnce({ rows: [armor] })     // armor
    .mockResolvedValueOnce({ rows: [shield] });   // shield
}

// ── Spies ─────────────────────────────────────────────────────────────────────

let executeSpy, batchSpy, clientTxSpy;

beforeEach(() => {
  executeSpy  = vi.spyOn(db.client, 'execute');
  batchSpy    = vi.spyOn(db.client, 'batch');
  // Spy on client.transaction (used by db.transaction()) to inject a fake tx
  clientTxSpy = vi.spyOn(db.client, 'transaction');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── GET /api/characters ───────────────────────────────────────────────────────

describe('GET /api/characters', () => {
  it('returns an array of enriched characters for the user', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    mockEnrich(executeSpy);

    const res = await request(app).get('/api/characters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(10);
    expect(res.body[0].inventory).toBeDefined();
  });
});

// ── POST /api/characters ──────────────────────────────────────────────────────

describe('POST /api/characters', () => {
  it('returns 400 if name is missing', async () => {
    const res = await request(app)
      .post('/api/characters')
      .send({ class: 'Warrior' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Name/);
  });

  it('returns 400 if name is empty string', async () => {
    const res = await request(app)
      .post('/api/characters')
      .send({ name: '', class: 'Warrior' });
    expect(res.status).toBe(400);
  });

  it('returns 400 if name exceeds 30 characters', async () => {
    const res = await request(app)
      .post('/api/characters')
      .send({ name: 'a'.repeat(31), class: 'Warrior' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid class', async () => {
    const res = await request(app)
      .post('/api/characters')
      .send({ name: 'Hero', class: 'Paladin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/class/i);
  });

  it('creates character with starting equipment (weapon 1, armor 3, shield 12)', async () => {
    // Mock client.transaction to return a fake tx object
    const fakeTxExecute = vi.fn()
      .mockResolvedValueOnce({ lastInsertRowid: 10n })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [baseChar] });
    const fakeTx = { execute: fakeTxExecute, commit: vi.fn(), rollback: vi.fn() };
    clientTxSpy.mockResolvedValueOnce(fakeTx);
    mockEnrich(executeSpy);

    const res = await request(app)
      .post('/api/characters')
      .send({ name: 'Hero', class: 'Warrior' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    expect(res.body.weapon_id).toBe(1);
    expect(res.body.armor_id).toBe(3);
    expect(res.body.shield_id).toBe(12);
  });

  it('returns 500 if transaction throws', async () => {
    clientTxSpy.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app)
      .post('/api/characters')
      .send({ name: 'Hero', class: 'Warrior' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/create character/i);
  });
});

// ── DELETE /api/characters/:id ────────────────────────────────────────────────

describe('DELETE /api/characters/:id', () => {
  it('returns 404 if character does not belong to user', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/characters/99');
    expect(res.status).toBe(404);
  });

  it('deletes character and returns { ok: true }', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).delete('/api/characters/10');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /api/characters/:id/avatar/preset ───────────────────────────────────

describe('POST /api/characters/:id/avatar/preset', () => {
  it('returns 400 for a non-DiceBear URL', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app)
      .post('/api/characters/10/avatar/preset')
      .send({ presetUrl: 'https://evil.com/avatar.jpg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid preset URL/);
  });

  it('returns 400 if presetUrl is not a string', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app)
      .post('/api/characters/10/avatar/preset')
      .send({ presetUrl: 12345 });
    expect(res.status).toBe(400);
  });

  it('saves a valid DiceBear URL', async () => {
    const diceBearUrl = 'https://api.dicebear.com/7.x/adventurer/svg?seed=Hero';
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({});
    const res = await request(app)
      .post('/api/characters/10/avatar/preset')
      .send({ presetUrl: diceBearUrl });
    expect(res.status).toBe(200);
    expect(res.body.avatarPath).toBe(diceBearUrl);
  });
});

// ── PUT /api/characters/:id/equip ─────────────────────────────────────────────

describe('PUT /api/characters/:id/equip', () => {
  // item rows as the equip validation query returns them: SELECT type, armor_slot FROM items
  const helmetItem = { id: 22, type: 'armor', armor_slot: 'helmet' };
  const routes = ({ char = baseChar, validation = null, inInventory = true, updated = char } = {}) => [
    [/FROM characters WHERE id = \? AND user_id/, { rows: [char] }],
    [/SELECT type, armor_slot FROM items/,        { rows: validation ? [validation] : [] }],
    [/SELECT id FROM inventory/,                  { rows: inInventory ? [{ id: 1 }] : [] }],
    [/SELECT \* FROM characters WHERE id = \?$/,   { rows: [updated] }],
    [/FROM items WHERE id/,                       args => ({ rows: [[weapon, armor, shield].find(i => i.id === args[0]) ?? null] }),],
  ];

  it('returns 400 for an invalid slot', async () => {
    routeSql(executeSpy, routes());
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'cape', item_id: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slot/);
  });

  it('unequips weapon when item_id is null', async () => {
    routeSql(executeSpy, routes({ updated: { ...baseChar, weapon_id: null } }));
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'weapon', item_id: null });
    expect(res.status).toBe(200);
    expect(sqlCalls(executeSpy).some(q => q.includes('SET weapon_id = NULL'))).toBe(true);
    expect(res.body.equippedWeapon).toBeNull();
  });

  it('returns 400 if the item does not exist', async () => {
    routeSql(executeSpy, routes());
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'weapon', item_id: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 if the item type does not fit the slot', async () => {
    routeSql(executeSpy, routes({ validation: { type: 'armor', armor_slot: 'body' } }));
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'weapon', item_id: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wrong item type/i);
  });

  it('returns 400 if the armor belongs in another slot', async () => {
    routeSql(executeSpy, routes({ validation: helmetItem }));
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'boots', item_id: 22 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/helmet slot/);
  });

  it('returns 400 if item is not in inventory', async () => {
    routeSql(executeSpy, routes({ validation: { type: 'weapon', armor_slot: null }, inInventory: false }));
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'weapon', item_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inventory/i);
  });

  it('equips an owned helmet', async () => {
    routeSql(executeSpy, routes({ validation: helmetItem }));
    const res = await request(app)
      .put('/api/characters/10/equip')
      .send({ slot: 'helmet', item_id: 22 });
    expect(res.status).toBe(200);
    const update = executeSpy.mock.calls.map(c => c[0]).find(q => q.sql?.includes('SET helmet_id = ?'));
    expect(update.args).toEqual([22, 10]);
  });
});

// ── PUT /api/characters/:id/attributes ───────────────────────────────────────

describe('PUT /api/characters/:id/attributes', () => {
  it('returns 400 if allocations is missing', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app)
      .put('/api/characters/10/attributes')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allocations/);
  });

  it('returns 400 for an unknown attribute key', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app)
      .put('/api/characters/10/attributes')
      .send({ allocations: { luck: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown attribute/);
  });

  it('returns 400 if total exceeds unspent points', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, unspent_points: 2 }] });
    const res = await request(app)
      .put('/api/characters/10/attributes')
      .send({ allocations: { strength: 5 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unspent points/i);
  });

  it('returns 400 if total is zero', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [{ ...baseChar, unspent_points: 5 }] });
    const res = await request(app)
      .put('/api/characters/10/attributes')
      .send({ allocations: { strength: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No points/i);
  });

  it('allocates points successfully and triggers max_hp recalc when vitality is allocated', async () => {
    const charWithPoints = { ...baseChar, unspent_points: 5, attr_vitality: 5 };
    const updatedChar    = { ...charWithPoints, attr_vitality: 7, unspent_points: 3, max_hp: 44 };
    executeSpy
      .mockResolvedValueOnce({ rows: [charWithPoints] })
      .mockResolvedValueOnce({})                           // UPDATE attributes
      .mockResolvedValueOnce({})                           // UPDATE max_hp
      .mockResolvedValueOnce({ rows: [updatedChar] })      // re-fetch
      .mockResolvedValueOnce({ rows: [] })                 // inventory
      .mockResolvedValueOnce({ rows: [weapon] })           // weapon
      .mockResolvedValueOnce({ rows: [armor] })            // armor
      .mockResolvedValueOnce({ rows: [shield] });          // shield
    const res = await request(app)
      .put('/api/characters/10/attributes')
      .send({ allocations: { vitality: 2 } });
    expect(res.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledTimes(8);
  });
});
