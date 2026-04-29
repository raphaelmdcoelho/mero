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

// ── Patch helpers.fullChar ────────────────────────────────────────────────────

const mockFullChar = vi.fn();
const helpersPath = require.resolve('../../server/helpers.js');
require.cache[helpersPath] = {
  id: helpersPath, filename: helpersPath, loaded: true,
  exports: { fullChar: mockFullChar },
};

// ── Pre-load shared modules ───────────────────────────────────────────────────

const db = require('../../server/db.js');
const router = require('../../server/routes/market.js');

// ── App ───────────────────────────────────────────────────────────────────────

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use('/api/market', router);
  return a;
})();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseChar = {
  id: 10, user_id: 1, name: 'Hero', level: 5,
  weapon_id: 1, armor_id: 3, shield_id: 12, gold: 0,
};
const fullCharResult = { ...baseChar, inventory: [], gold: 0 };

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

// ── POST /api/market/:characterId/sell ────────────────────────────────────────

describe('POST /api/market/:characterId/sell', () => {
  it('returns 404 if character not found', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 1, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 400 if inv_id is missing or zero', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app).post('/api/market/10/sell').send({ quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inv_id/);
  });

  it('returns 404 if inventory row not found', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 99, quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not in inventory/i);
  });

  it('returns 400 if not enough quantity', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [{ id: 1, quantity: 1, item_id: 5, name: 'Health Potion', sell_price: 8, type: 'consumable' }] });
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 1, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not enough quantity/);
  });

  it('returns 400 if trying to sell an equipped weapon', async () => {
    const equippedItem = { id: 1, quantity: 1, item_id: 1, name: 'Wooden Sword', sell_price: 5, type: 'weapon' };
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [equippedItem] });
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 1, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unequip/);
  });

  it('returns 400 if item sell_price is 0', async () => {
    const unsellableItem = { id: 5, quantity: 1, item_id: 50, name: 'Quest Token', sell_price: 0, type: 'misc' };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null }] })
      .mockResolvedValueOnce({ rows: [unsellableItem] });
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 5, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be sold/);
  });

  it('deletes inventory row when selling full stack and awards gold', async () => {
    const item = { id: 2, quantity: 3, item_id: 5, name: 'Health Potion', sell_price: 8, type: 'consumable' };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null }] })
      .mockResolvedValueOnce({ rows: [item] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 2, quantity: 3 });
    expect(res.status).toBe(200);
    expect(res.body.gold).toBe(24);
    expect(batchSpy.mock.calls[0][0][0].sql).toContain('DELETE FROM inventory');
  });

  it('decrements quantity when selling partial stack', async () => {
    const item = { id: 3, quantity: 5, item_id: 5, name: 'Health Potion', sell_price: 8, type: 'consumable' };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null }] })
      .mockResolvedValueOnce({ rows: [item] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 3, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.gold).toBe(16);
    expect(batchSpy.mock.calls[0][0][0].sql).toContain('UPDATE inventory SET quantity = quantity - ?');
  });

  it('treats quantity: 0 as quantity: 1 (minimum floor)', async () => {
    const item = { id: 4, quantity: 2, item_id: 5, name: 'Health Potion', sell_price: 8, type: 'consumable' };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null }] })
      .mockResolvedValueOnce({ rows: [item] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/market/10/sell').send({ inv_id: 4, quantity: 0 });
    expect(res.status).toBe(200);
    expect(res.body.gold).toBe(8);
  });
});

// ── GET /api/market/:characterId/shop ─────────────────────────────────────────

describe('GET /api/market/:characterId/shop', () => {
  it('returns 404 if character not found', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/market/10/shop');
    expect(res.status).toBe(404);
  });

  it('returns list of items with buy_price > 0', async () => {
    const shopItems = [
      { id: 5, name: 'Health Potion', type: 'consumable', description: 'Restores 5 HP', icon: '🧪', damage: 0, defense: 0, weapon_type: null, armor_slot: null, sell_price: 8, buy_price: 15 },
    ];
    executeSpy
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: shopItems });
    const res = await request(app).get('/api/market/10/shop');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].buy_price).toBe(15);
  });
});

// ── POST /api/market/:characterId/buy ─────────────────────────────────────────

describe('POST /api/market/:characterId/buy', () => {
  it('returns 404 if character not found', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/market/10/buy').send({ item_id: 5, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 400 if item_id is missing', async () => {
    executeSpy.mockResolvedValueOnce({ rows: [baseChar] });
    const res = await request(app).post('/api/market/10/buy').send({ quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/item_id/);
  });

  it('returns 404 if item not available for purchase', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/market/10/buy').send({ item_id: 99, quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not available/i);
  });

  it('returns 400 if not enough gold', async () => {
    const shopItem = { id: 5, name: 'Health Potion', buy_price: 15 };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, gold: 5 }] })
      .mockResolvedValueOnce({ rows: [shopItem] });
    const res = await request(app).post('/api/market/10/buy').send({ item_id: 5, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not enough gold/);
  });

  it('inserts new inventory row when item not already owned', async () => {
    const shopItem = { id: 5, name: 'Health Potion', buy_price: 15 };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, gold: 50 }] })
      .mockResolvedValueOnce({ rows: [shopItem] })
      .mockResolvedValueOnce({ rows: [] }); // no existing inventory row
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/market/10/buy').send({ item_id: 5, quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.spent).toBe(15);
    expect(batchSpy.mock.calls[0][0][0].sql).toContain('INSERT INTO inventory');
  });

  it('increments quantity when item already in inventory', async () => {
    const shopItem = { id: 5, name: 'Health Potion', buy_price: 15 };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, gold: 100 }] })
      .mockResolvedValueOnce({ rows: [shopItem] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // existing inventory row id 7
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/market/10/buy').send({ item_id: 5, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.spent).toBe(30);
    expect(batchSpy.mock.calls[0][0][0].sql).toContain('UPDATE inventory SET quantity = quantity + ?');
  });

  it('treats quantity: 0 as quantity: 1 (minimum floor)', async () => {
    const shopItem = { id: 5, name: 'Health Potion', buy_price: 15 };
    executeSpy
      .mockResolvedValueOnce({ rows: [{ ...baseChar, gold: 50 }] })
      .mockResolvedValueOnce({ rows: [shopItem] })
      .mockResolvedValueOnce({ rows: [] });
    batchSpy.mockResolvedValueOnce({});
    const res = await request(app).post('/api/market/10/buy').send({ item_id: 5, quantity: 0 });
    expect(res.status).toBe(200);
    expect(res.body.spent).toBe(15);
  });
});
