const express = require('express');
const { db } = require('../db');
const protect = require('../middleware/protect');

const router = express.Router();
router.use(protect);

// Grow times in seconds
const GROW_TIME = { carrot: 9 * 60, apple: 5 * 60 };
const PLANT_ITEM_IDS = { carrot: 6, apple: 7 };

// Move any ready farm_queue entries into the regular inventory
function harvestReady(charId) {
  const now = Math.floor(Date.now() / 1000);
  const ready = db.prepare(
    'SELECT * FROM farm_queue WHERE character_id = ? AND ready_at <= ?'
  ).all(charId, now);

  for (const job of ready) {
    const itemId = PLANT_ITEM_IDS[job.plant_type];
    if (!itemId) continue;
    const existing = db.prepare(
      'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?'
    ).get(charId, itemId);
    if (existing) {
      db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)').run(charId, itemId);
    }
    db.prepare('DELETE FROM farm_queue WHERE id = ?').run(job.id);
  }
}

function farmStatus(charId) {
  harvestReady(charId);
  const farmQueue = db.prepare(
    'SELECT id, plant_type, ready_at FROM farm_queue WHERE character_id = ? ORDER BY ready_at ASC'
  ).all(charId).map(r => Object.assign({}, r));
  return { farmQueue };
}

// GET /api/farm/:characterId — get current farm status
router.get('/:characterId', (req, res) => {
  const char = db.prepare('SELECT id, user_id, level FROM characters WHERE id = ? AND user_id = ?')
    .get(req.params.characterId, req.user.userId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  res.json(farmStatus(char.id));
});

// POST /api/farm/:characterId/grow — start growing a plant
router.post('/:characterId/grow', (req, res) => {
  const char = db.prepare('SELECT id, user_id, level FROM characters WHERE id = ? AND user_id = ?')
    .get(req.params.characterId, req.user.userId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  if (Number(char.level) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }

  const { plant_type } = req.body;
  if (!['carrot', 'apple'].includes(plant_type)) {
    return res.status(400).json({ error: 'plant_type must be "carrot" or "apple"' });
  }

  const now = Math.floor(Date.now() / 1000);
  const readyAt = now + GROW_TIME[plant_type];
  db.prepare('INSERT INTO farm_queue (character_id, plant_type, ready_at) VALUES (?, ?, ?)')
    .run(char.id, plant_type, readyAt);

  res.json(farmStatus(char.id));
});

module.exports = router;
