const express = require('express');
const { db } = require('../db');
const protect = require('../middleware/protect');

const router = express.Router();
router.use(protect);

const RATES = {
  easy:   { xp: 1, hp: -1 },
  medium: { xp: 2, hp: -2 },
  hard:   { xp: 4, hp: -4 },
};
const TAVERN_HP_RATE = 2;

function levelUp(char) {
  let { xp, xp_to_next, level, max_hp, hp } = char;
  while (xp >= xp_to_next) {
    xp -= xp_to_next;
    level += 1;
    xp_to_next = Math.floor(10 * Math.pow(1.5, level - 1));
    max_hp = 10 + (level - 1) * 5;
    hp = max_hp;
  }
  return { xp, xp_to_next, level, max_hp, hp };
}

function applyTick(char) {
  const now = Math.floor(Date.now() / 1000);
  const lastTick = char.last_tick_at || char.activity_started_at || now;
  const elapsed = Math.max(0, now - lastTick);

  let { xp, xp_to_next, level, max_hp, hp, activity, dungeon_difficulty } = char;
  // Ensure numeric types (node:sqlite returns numbers but guard anyway)
  xp = Number(xp); xp_to_next = Number(xp_to_next); level = Number(level);
  max_hp = Number(max_hp); hp = Number(hp);

  let fallen = false;

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
  }

  xp = Math.floor(xp);
  hp = Math.max(1, Math.round(hp * 10) / 10);

  const leveled = levelUp({ xp, xp_to_next, level, max_hp, hp });
  xp        = leveled.xp;
  xp_to_next = leveled.xp_to_next;
  level     = leveled.level;
  max_hp    = leveled.max_hp;
  hp        = Math.min(leveled.hp, leveled.max_hp);

  return {
    xp, xp_to_next, level, max_hp, hp,
    activity: fallen ? null : activity,
    activity_started_at: fallen ? null : char.activity_started_at,
    dungeon_difficulty: fallen ? null : char.dungeon_difficulty,
    last_tick_at: now,
    fallen,
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
  return { ...char, inventory, equippedWeapon, equippedArmor };
}

// POST /api/game/:characterId/start
router.post('/:characterId/start', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  const { action, difficulty } = req.body;
  if (!['dungeon', 'tavern'].includes(action)) {
    return res.status(400).json({ error: 'action must be "dungeon" or "tavern"' });
  }
  if (action === 'dungeon' && !['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be easy, medium, or hard' });
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE characters SET activity = ?, activity_started_at = ?, dungeon_difficulty = ?, last_tick_at = ?
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
      activity = NULL, activity_started_at = NULL, dungeon_difficulty = NULL, last_tick_at = ?
    WHERE id = ?
  `).run(updates.xp, updates.xp_to_next, updates.level, updates.max_hp, updates.hp,
         updates.last_tick_at, char.id);

  res.json(fullChar(char.id));
});

// GET /api/game/:characterId/tick
router.get('/:characterId/tick', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  if (!char.activity) {
    return res.json({ ...fullChar(char.id), fallen: false });
  }

  const updates = applyTick(char);
  db.prepare(`
    UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
      activity = ?, activity_started_at = ?, dungeon_difficulty = ?, last_tick_at = ?
    WHERE id = ?
  `).run(
    updates.xp, updates.xp_to_next, updates.level, updates.max_hp, updates.hp,
    updates.activity, updates.activity_started_at, updates.dungeon_difficulty,
    updates.last_tick_at, char.id
  );

  res.json({ ...fullChar(char.id), fallen: updates.fallen });
});

module.exports = router;
