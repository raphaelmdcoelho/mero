const express = require('express');
const { db, transaction } = require('../db');
const protect = require('../middleware/protect');

const router = express.Router();
router.use(protect);

function fullChar(charId) {
  const char = Object.assign({}, db.prepare('SELECT * FROM characters WHERE id = ?').get(charId));
  const inventory = db.prepare(`
    SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon,
           i.damage, i.defense, i.weapon_type, i.sell_price
    FROM inventory inv JOIN items i ON i.id = inv.item_id
    WHERE inv.character_id = ?
  `).all(charId).map(r => Object.assign({}, r));
  const equippedWeapon = char.weapon_id
    ? Object.assign({}, db.prepare('SELECT * FROM items WHERE id = ?').get(char.weapon_id)) : null;
  const equippedArmor = char.armor_id
    ? Object.assign({}, db.prepare('SELECT * FROM items WHERE id = ?').get(char.armor_id)) : null;
  const farmQueue = db.prepare(
    'SELECT id, plant_type, ready_at FROM farm_queue WHERE character_id = ? ORDER BY ready_at ASC'
  ).all(charId).map(r => Object.assign({}, r));
  const runRow = db.prepare('SELECT * FROM dungeon_run WHERE character_id = ?').get(charId);
  let dungeonRun = null;
  if (runRow) {
    dungeonRun = Object.assign({}, runRow);
    dungeonRun.monster = Object.assign({}, db.prepare('SELECT * FROM monsters WHERE id = ?').get(runRow.monster_id));
  }
  return { ...char, inventory, equippedWeapon, equippedArmor, farmQueue, dungeonRun };
}

// POST /api/market/:characterId/sell
// body: { inv_id: number, quantity: number }
router.post('/:characterId/sell', (req, res) => {
  const charId = Number(req.params.characterId);
  const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?')
    .get(charId, req.user.userId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const invId = Number(req.body.inv_id);
  const qty   = Math.max(1, Number(req.body.quantity) || 1);

  if (!invId) return res.status(400).json({ error: 'inv_id required' });

  const invRow = db.prepare(`
    SELECT inv.id, inv.quantity, inv.item_id,
           i.name, i.sell_price, i.type
    FROM inventory inv JOIN items i ON i.id = inv.item_id
    WHERE inv.id = ? AND inv.character_id = ?
  `).get(invId, charId);

  if (!invRow) return res.status(404).json({ error: 'Item not in inventory' });
  if (invRow.quantity < qty) return res.status(400).json({ error: 'Not enough quantity' });

  // Cannot sell equipped items
  if (invRow.item_id === char.weapon_id || invRow.item_id === char.armor_id) {
    return res.status(400).json({ error: 'Unequip the item before selling' });
  }

  const price = Number(invRow.sell_price) || 0;
  if (price <= 0) return res.status(400).json({ error: 'This item cannot be sold' });

  const earned = price * qty;

  transaction(() => {
    if (invRow.quantity === qty) {
      db.prepare('DELETE FROM inventory WHERE id = ?').run(invId);
    } else {
      db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(qty, invId);
    }
    db.prepare('UPDATE characters SET gold = gold + ? WHERE id = ?').run(earned, charId);
  });

  res.json({ gold: earned, char: fullChar(charId) });
});

module.exports = router;
