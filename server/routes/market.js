'use strict';
const express = require('express');
const { client } = require('../db');
const protect = require('../middleware/protect');
const { fullChar } = require('../helpers');

const router = express.Router();
router.use(protect);

// POST /api/market/:characterId/sell
// body: { inv_id: number, quantity: number }
// GET /api/market/:characterId/shop
// Returns all items with a buy_price > 0
router.get('/:characterId/shop', async (req, res) => {
  const charId = Number(req.params.characterId);
  const charR = await client.execute({
    sql:  'SELECT id FROM characters WHERE id = ? AND user_id = ?',
    args: [charId, req.user.userId],
  });
  if (!charR.rows[0]) return res.status(404).json({ error: 'Character not found' });

  const itemsR = await client.execute(
    'SELECT id, name, type, description, icon, damage, defense, weapon_type, armor_slot, sell_price, buy_price FROM items WHERE buy_price > 0 ORDER BY type, buy_price'
  );
  res.json({ items: itemsR.rows });
});

// POST /api/market/:characterId/buy
// body: { item_id: number, quantity: number }
router.post('/:characterId/buy', async (req, res) => {
  const charId = Number(req.params.characterId);
  const charR = await client.execute({
    sql:  'SELECT * FROM characters WHERE id = ? AND user_id = ?',
    args: [charId, req.user.userId],
  });
  const char = charR.rows[0] ?? null;
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const itemId = Number(req.body.item_id);
  const qty    = Math.max(1, Number(req.body.quantity) || 1);

  if (!itemId) return res.status(400).json({ error: 'item_id required' });

  const itemR = await client.execute({
    sql:  'SELECT id, name, buy_price FROM items WHERE id = ? AND buy_price > 0',
    args: [itemId],
  });
  const item = itemR.rows[0] ?? null;
  if (!item) return res.status(404).json({ error: 'Item not available for purchase' });

  const cost = Number(item.buy_price) * qty;
  if (Number(char.gold) < cost) return res.status(400).json({ error: 'Not enough gold' });

  // Upsert into inventory (stack if already owned)
  const existingR = await client.execute({
    sql:  'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
    args: [charId, itemId],
  });
  const existing = existingR.rows[0] ?? null;

  await client.batch([
    existing
      ? { sql: 'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',                    args: [qty, existing.id] }
      : { sql: 'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, ?)',     args: [charId, itemId, qty] },
    { sql: 'UPDATE characters SET gold = gold - ? WHERE id = ?', args: [cost, charId] },
  ], 'write');

  res.json({ spent: cost, char: await fullChar(charId) });
});

// POST /api/market/:characterId/sell
router.post('/:characterId/sell', async (req, res) => {
  const charId = Number(req.params.characterId);
  const charR = await client.execute({
    sql:  'SELECT * FROM characters WHERE id = ? AND user_id = ?',
    args: [charId, req.user.userId],
  });
  const char = charR.rows[0] ?? null;
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const invId = Number(req.body.inv_id);
  const qty   = Math.max(1, Number(req.body.quantity) || 1);

  if (!invId) return res.status(400).json({ error: 'inv_id required' });

  const invR = await client.execute({
    sql: `SELECT inv.id, inv.quantity, inv.item_id,
                 i.name, i.sell_price, i.type
          FROM inventory inv JOIN items i ON i.id = inv.item_id
          WHERE inv.id = ? AND inv.character_id = ?`,
    args: [invId, charId],
  });
  const invRow = invR.rows[0] ?? null;

  if (!invRow) return res.status(404).json({ error: 'Item not in inventory' });
  if (invRow.quantity < qty) return res.status(400).json({ error: 'Not enough quantity' });

  // Cannot sell equipped items
  if (invRow.item_id === char.weapon_id || invRow.item_id === char.armor_id || invRow.item_id === char.shield_id) {
    return res.status(400).json({ error: 'Unequip the item before selling' });
  }

  const price = Number(invRow.sell_price) || 0;
  if (price <= 0) return res.status(400).json({ error: 'This item cannot be sold' });

  const earned = price * qty;

  await client.batch([
    invRow.quantity === qty
      ? { sql: 'DELETE FROM inventory WHERE id = ?',                        args: [invId] }
      : { sql: 'UPDATE inventory SET quantity = quantity - ? WHERE id = ?', args: [qty, invId] },
    { sql: 'UPDATE characters SET gold = gold + ? WHERE id = ?', args: [earned, charId] },
  ], 'write');

  res.json({ gold: earned, char: await fullChar(charId) });
});

module.exports = router;
