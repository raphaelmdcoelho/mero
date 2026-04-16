'use strict';
const express = require('express');
const { client } = require('../db');
const protect = require('../middleware/protect');

const router = express.Router();
router.use(protect);

// Grow times in seconds
const GROW_TIME = { carrot: 9 * 60, apple: 5 * 60 };
const PLANT_ITEM_IDS = { carrot: 6, apple: 7 };

// Move any ready farm_queue entries into the regular inventory
async function harvestReady(charId) {
  const r = await client.execute({
    sql:  'SELECT * FROM farm_queue WHERE character_id = ? AND COALESCE(remaining_seconds, 0) <= 0',
    args: [charId],
  });

  for (const job of r.rows) {
    const itemId = PLANT_ITEM_IDS[job.plant_type];
    if (!itemId) continue;
    const existR = await client.execute({
      sql:  'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
      args: [charId, itemId],
    });
    const existing = existR.rows[0] ?? null;
    if (existing) {
      await client.execute({
        sql:  'UPDATE inventory SET quantity = quantity + 1 WHERE id = ?',
        args: [existing.id],
      });
    } else {
      await client.execute({
        sql:  'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)',
        args: [charId, itemId],
      });
    }
    await client.execute({ sql: 'DELETE FROM farm_queue WHERE id = ?', args: [job.id] });
  }
}

async function farmStatus(charId) {
  await harvestReady(charId);
  const r = await client.execute({
    sql:  'SELECT id, plant_type, ready_at, remaining_seconds FROM farm_queue WHERE character_id = ? ORDER BY id ASC',
    args: [charId],
  });
  return { farmQueue: r.rows.map(row => Object.assign({}, row)) };
}

// GET /api/farm/:characterId — get current farm status
router.get('/:characterId', async (req, res) => {
  const r = await client.execute({
    sql:  'SELECT id, user_id, level FROM characters WHERE id = ? AND user_id = ?',
    args: [req.params.characterId, req.user.userId],
  });
  const char = r.rows[0] ?? null;
  if (!char) return res.status(404).json({ error: 'Character not found' });

  res.json(await farmStatus(char.id));
});

// POST /api/farm/:characterId/grow — start growing a plant
router.post('/:characterId/grow', async (req, res) => {
  const r = await client.execute({
    sql:  'SELECT id, user_id, level FROM characters WHERE id = ? AND user_id = ?',
    args: [req.params.characterId, req.user.userId],
  });
  const char = r.rows[0] ?? null;
  if (!char) return res.status(404).json({ error: 'Character not found' });

  if (Number(char.level) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }

  const { plant_type } = req.body;
  if (!['carrot', 'apple'].includes(plant_type)) {
    return res.status(400).json({ error: 'plant_type must be "carrot" or "apple"' });
  }

  const now = Math.floor(Date.now() / 1000);
  const remainingSeconds = GROW_TIME[plant_type];
  await client.execute({
    sql:  'INSERT INTO farm_queue (character_id, plant_type, ready_at, remaining_seconds, last_progress_at) VALUES (?, ?, ?, ?, ?)',
    args: [char.id, plant_type, now + remainingSeconds, remainingSeconds, null],
  });

  res.json(await farmStatus(char.id));
});

module.exports = router;
