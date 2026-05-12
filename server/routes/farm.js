'use strict';
const express = require('express');
const { client } = require('../db');
const protect = require('../middleware/protect');

const router = express.Router();
router.use(protect);

const GROW_TIME = {
  carrot: 5 * 60,
  apple:  5 * 60,
  onion:  5 * 60,
  corn:   5 * 60,
};

const PLANT_ITEM_IDS = { carrot: 6, apple: 7, onion: 29, corn: 30 };
const VALID_PLANTS   = new Set(Object.keys(GROW_TIME));
const FARM_MAX_LEVEL = 12;

function xpToNext(farmLevel) {
  return farmLevel * 5;
}

async function harvestReady(charId) {
  const now = Math.floor(Date.now() / 1000);
  const r = await client.execute({
    sql:  'SELECT * FROM farm_queue WHERE character_id = ? AND ready_at <= ?',
    args: [charId, now],
  });

  const harvested = {};
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
    harvested[job.plant_type] = (harvested[job.plant_type] || 0) + 1;
  }

  const totalHarvested = Object.values(harvested).reduce((s, v) => s + v, 0);
  if (totalHarvested > 0) {
    const charR = await client.execute({
      sql:  'SELECT farm_level, farm_xp FROM characters WHERE id = ?',
      args: [charId],
    });
    let { farm_level, farm_xp } = charR.rows[0];
    farm_level = Number(farm_level) || 1;
    farm_xp    = Number(farm_xp)    + totalHarvested;

    while (farm_level < FARM_MAX_LEVEL && farm_xp >= xpToNext(farm_level)) {
      farm_xp -= xpToNext(farm_level);
      farm_level++;
    }
    if (farm_level >= FARM_MAX_LEVEL) farm_xp = Math.min(farm_xp, xpToNext(FARM_MAX_LEVEL) - 1);

    await client.execute({
      sql:  'UPDATE characters SET farm_level = ?, farm_xp = ? WHERE id = ?',
      args: [farm_level, farm_xp, charId],
    });
  }

  return Object.entries(harvested).map(([plant_type, quantity]) => ({ plant_type, quantity }));
}

async function farmStatus(charId) {
  await harvestReady(charId);
  const [queueR, charR] = await Promise.all([
    client.execute({
      sql:  'SELECT id, plant_type, ready_at, remaining_seconds FROM farm_queue WHERE character_id = ? ORDER BY id ASC',
      args: [charId],
    }),
    client.execute({
      sql:  'SELECT farm_level, farm_xp FROM characters WHERE id = ?',
      args: [charId],
    }),
  ]);
  const farmLevel = Number(charR.rows[0].farm_level) || 1;
  const farmXp    = Number(charR.rows[0].farm_xp)    || 0;
  return {
    farmQueue:    queueR.rows.map(row => Object.assign({}, row)),
    farmLevel,
    farmXp,
    farmXpToNext: xpToNext(farmLevel),
  };
}

async function ownedChar(req, res) {
  const r = await client.execute({
    sql:  'SELECT id, user_id, level, farm_level, farm_xp FROM characters WHERE id = ? AND user_id = ?',
    args: [req.params.characterId, req.user.userId],
  });
  const char = r.rows[0] ?? null;
  if (!char) res.status(404).json({ error: 'Character not found' });
  return char;
}

// GET /api/farm/:characterId — get current farm status
router.get('/:characterId', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;
  res.json(await farmStatus(char.id));
});

// GET /api/farm/:characterId/status — same as above, used by poll
router.get('/:characterId/status', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;
  const status = await farmStatus(char.id);
  res.json(status);
});

// GET /api/farm/:characterId/harvest — harvest ready plants, return what was collected
router.get('/:characterId/harvest', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;
  const harvested = await harvestReady(char.id);
  const status = await farmStatus(char.id);
  res.json({ harvested, ...status });
});

// POST /api/farm/:characterId/start — start growing with a slots array
router.post('/:characterId/start', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  if (Number(char.level) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }

  const farmLevel = Number(char.farm_level) || 1;

  const { slots } = req.body;
  if (!Array.isArray(slots) || slots.length > 12) {
    return res.status(400).json({ error: 'slots must be an array of up to 12 entries' });
  }

  const plantSlots = slots.filter(s => s !== null && s !== undefined && s !== '');
  if (plantSlots.length === 0) {
    return res.status(400).json({ error: 'At least one plant is required' });
  }
  if (plantSlots.length > farmLevel) {
    return res.status(400).json({ error: `Farm level ${farmLevel} allows only ${farmLevel} slot(s)` });
  }

  for (const plant of plantSlots) {
    if (!VALID_PLANTS.has(plant)) {
      return res.status(400).json({ error: `Invalid plant type: ${plant}` });
    }
  }

  // Cancel any existing farm queue for this character
  await client.execute({ sql: 'DELETE FROM farm_queue WHERE character_id = ?', args: [char.id] });

  const now = Math.floor(Date.now() / 1000);
  const maxGrowTime = Math.max(...plantSlots.map(p => GROW_TIME[p]));

  for (const plantType of plantSlots) {
    const growTime = GROW_TIME[plantType];
    await client.execute({
      sql:  'INSERT INTO farm_queue (character_id, plant_type, ready_at, remaining_seconds, last_progress_at) VALUES (?, ?, ?, ?, ?)',
      args: [char.id, plantType, now + growTime, growTime, now],
    });
  }

  const status = await farmStatus(char.id);
  res.json({ ...status, durationSeconds: maxGrowTime });
});

// DELETE /api/farm/:characterId — cancel active grow session
router.delete('/:characterId', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;
  await client.execute({ sql: 'DELETE FROM farm_queue WHERE character_id = ?', args: [char.id] });
  res.json({ farmQueue: [] });
});

// POST /api/farm/:characterId/grow — legacy single-plant endpoint (kept for backward compat)
router.post('/:characterId/grow', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  if (Number(char.level) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }

  const { plant_type } = req.body;
  if (!VALID_PLANTS.has(plant_type)) {
    return res.status(400).json({ error: 'Invalid plant_type' });
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
