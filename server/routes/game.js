const express = require('express');
const { db } = require('../db');
const protect = require('../middleware/protect');

// item_id -> HP restored
const PLANT_ITEM_HP = { 6: 2, 7: 1 }; // 6=Carrot, 7=Apple

// Move any ready farm_queue entries into the regular inventory
function harvestFarm(charId) {
  const now = Math.floor(Date.now() / 1000);
  const PLANT_ITEM_IDS = { carrot: 6, apple: 7 };
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

const router = express.Router();
router.use(protect);

const RATES = {
  easy:   { xp: 1, hp: -1 },
  medium: { xp: 2, hp: -2 },
  hard:   { xp: 4, hp: -4 },
};
const TAVERN_HP_RATE = 2;
const POINTS_PER_LEVEL = 5;

function levelUp(char) {
  let { xp, xp_to_next, level, max_hp, hp, unspent_points } = char;
  unspent_points = Number(unspent_points) || 0;
  while (xp >= xp_to_next) {
    xp -= xp_to_next;
    level += 1;
    xp_to_next = Math.floor(10 * Math.pow(1.5, level - 1));
    max_hp = 10 + (level - 1) * 5;
    hp = max_hp;
    unspent_points += POINTS_PER_LEVEL;
  }
  return { xp, xp_to_next, level, max_hp, hp, unspent_points };
}

const READING_POINT_INTERVAL = 30 * 60; // 30 min in seconds
const READING_MAX_DURATION   = 60 * 60; // 1 hour in seconds

function applyTick(char) {
  const now = Math.floor(Date.now() / 1000);
  const lastTick = char.last_tick_at || char.activity_started_at || now;
  const elapsed = Math.max(0, now - lastTick);

  let { xp, xp_to_next, level, max_hp, hp, activity, dungeon_difficulty, unspent_points } = char;
  xp = Number(xp); xp_to_next = Number(xp_to_next); level = Number(level);
  max_hp = Number(max_hp); hp = Number(hp);
  let reading_points_awarded = Number(char.reading_points_awarded) || 0;

  let fallen = false;
  let readingFinished = false;

  if (activity === 'dungeon' && dungeon_difficulty) {
    const rate = RATES[dungeon_difficulty];
    if (rate) {
      xp += (rate.xp * elapsed) / 60;
      hp -= (Math.abs(rate.hp) * elapsed) / 60;
    }
    if (hp <= 0) {
      hp = 1;
      activity = null;
      fallen = true;
    }
  } else if (activity === 'tavern') {
    hp = Math.min(max_hp, hp + (TAVERN_HP_RATE * elapsed) / 60);
  } else if (activity === 'reading') {
    const totalElapsed = Math.max(0, now - (char.activity_started_at || now));
    // Award 1 point per 30-min interval, max 2 (at 30 min and 60 min)
    const pointsDue = Math.min(2, Math.floor(totalElapsed / READING_POINT_INTERVAL));
    const newPoints = pointsDue - reading_points_awarded;
    if (newPoints > 0) {
      unspent_points += newPoints;
      reading_points_awarded = pointsDue;
    }
    // Auto-stop after 1 hour
    if (totalElapsed >= READING_MAX_DURATION) {
      activity = null;
      readingFinished = true;
    }
  }

  // Keep xp as float so fractional gains accumulate between ticks.
  // (SQLite stores it as REAL transparently; client floors for display.)
  hp = Math.max(1, Math.round(hp * 10) / 10);

  const leveled = levelUp({ xp, xp_to_next, level, max_hp, hp, unspent_points });
  xp             = leveled.xp;
  xp_to_next     = leveled.xp_to_next;
  level          = leveled.level;
  max_hp         = leveled.max_hp;
  hp             = Math.min(leveled.hp, leveled.max_hp);
  unspent_points = leveled.unspent_points;

  const stopped = fallen || readingFinished;
  return {
    xp, xp_to_next, level, max_hp, hp, unspent_points,
    reading_points_awarded: stopped ? 0 : reading_points_awarded,
    activity: stopped ? null : activity,
    activity_started_at: stopped ? null : char.activity_started_at,
    dungeon_difficulty: stopped ? null : char.dungeon_difficulty,
    last_tick_at: now,
    fallen,
    readingFinished,
  };
}

function ownedChar(req, res) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?')
    .get(req.params.characterId, req.user.userId);
  if (!char) res.status(404).json({ error: 'Character not found' });
  return char ? Object.assign({}, char) : null;
}

function fullChar(charId) {
  const char = Object.assign({}, db.prepare('SELECT * FROM characters WHERE id = ?').get(charId));
  const inventory = db.prepare(`
    SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon
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
  return { ...char, inventory, equippedWeapon, equippedArmor, farmQueue };
}

// POST /api/game/:characterId/start
router.post('/:characterId/start', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  const { action, difficulty } = req.body;
  if (!['dungeon', 'tavern', 'reading'].includes(action)) {
    return res.status(400).json({ error: 'action must be "dungeon", "tavern", or "reading"' });
  }
  if (action === 'dungeon' && !['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be easy, medium, or hard' });
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE characters SET activity = ?, activity_started_at = ?, dungeon_difficulty = ?,
      last_tick_at = ?, reading_points_awarded = 0
    WHERE id = ?
  `).run(action, now, action === 'dungeon' ? difficulty : null, now, char.id);

  res.json(fullChar(char.id));
});

// POST /api/game/:characterId/stop
router.post('/:characterId/stop', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  const updates = applyTick(char);
  db.prepare(`
    UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
      unspent_points = ?, reading_points_awarded = 0,
      activity = NULL, activity_started_at = NULL, dungeon_difficulty = NULL, last_tick_at = ?
    WHERE id = ?
  `).run(updates.xp, updates.xp_to_next, updates.level, updates.max_hp, updates.hp,
         updates.unspent_points, updates.last_tick_at, char.id);

  res.json(fullChar(char.id));
});

// GET /api/game/:characterId/tick
router.get('/:characterId/tick', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  // Harvest any ready farm plants on every tick
  harvestFarm(char.id);

  if (!char.activity) {
    return res.json({ ...fullChar(char.id), fallen: false });
  }

  const updates = applyTick(char);

  // If hero would fall, try consuming a plant from inventory to save them
  let plantConsumed = null;
  if (updates.fallen) {
    // Prefer carrot (item_id 6, 2 HP) over apple (item_id 7, 1 HP)
    const plantInv = db.prepare(`
      SELECT inv.id, inv.item_id, inv.quantity
      FROM inventory inv
      WHERE inv.character_id = ? AND inv.item_id IN (6, 7) AND inv.quantity > 0
      ORDER BY inv.item_id ASC
      LIMIT 1
    `).get(char.id);

    if (plantInv) {
      if (plantInv.quantity <= 1) {
        db.prepare('DELETE FROM inventory WHERE id = ?').run(plantInv.id);
      } else {
        db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(plantInv.id);
      }
      const hpRestore = PLANT_ITEM_HP[plantInv.item_id] || 1;
      updates.hp = Math.min(hpRestore, updates.max_hp);
      updates.fallen = false;
      updates.activity = char.activity;
      updates.activity_started_at = char.activity_started_at;
      updates.dungeon_difficulty = char.dungeon_difficulty;
      plantConsumed = plantInv.item_id === 6 ? 'carrot' : 'apple';
    }
  }

  db.prepare(`
    UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
      unspent_points = ?, reading_points_awarded = ?,
      activity = ?, activity_started_at = ?, dungeon_difficulty = ?, last_tick_at = ?
    WHERE id = ?
  `).run(
    updates.xp, updates.xp_to_next, updates.level, updates.max_hp, updates.hp,
    updates.unspent_points, updates.reading_points_awarded,
    updates.activity, updates.activity_started_at, updates.dungeon_difficulty,
    updates.last_tick_at, char.id
  );

  res.json({ ...fullChar(char.id), fallen: updates.fallen, plantConsumed, readingFinished: updates.readingFinished || false });
});

module.exports = router;
