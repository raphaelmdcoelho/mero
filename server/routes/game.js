const express = require('express');
const { db, transaction } = require('../db');
const protect = require('../middleware/protect');

// item_id -> HP restored (farm plants)
const PLANT_ITEM_HP = { 6: 2, 7: 1 };
const KILLS_FOR_BOSS = 100;
const TAVERN_HP_RATE = 2; // HP/min
const POINTS_PER_LEVEL = 5;

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

// Compute max_hp including vitality bonus
function calcMaxHp(level, vitality) {
  return 10 + (level - 1) * 5 + vitality * 2;
}

function levelUp(char) {
  let { xp, xp_to_next, level, hp, unspent_points } = char;
  const vitality = Number(char.attr_vitality) || 5;
  unspent_points = Number(unspent_points) || 0;
  let leveled = false;
  while (xp >= xp_to_next) {
    xp -= xp_to_next;
    level += 1;
    xp_to_next = Math.floor(10 * Math.pow(1.5, level - 1));
    unspent_points += POINTS_PER_LEVEL;
    leveled = true;
  }
  const max_hp = calcMaxHp(level, vitality);
  if (leveled) hp = max_hp;
  return { xp, xp_to_next, level, max_hp, hp: Math.min(hp, max_hp), unspent_points };
}

// Derive combat stats from character row
function combatStats(char) {
  const str = Number(char.attr_strength)   || 5;
  const dex = Number(char.attr_dexterity)  || 5;
  const agi = Number(char.attr_agility)    || 5;
  const vit = Number(char.attr_vitality)   || 5;
  const res = Number(char.attr_resistance) || 5;
  const level = Number(char.level) || 1;

  const weapon = char.weapon_id
    ? Object.assign({}, db.prepare('SELECT * FROM items WHERE id = ?').get(char.weapon_id))
    : null;
  const armor = char.armor_id
    ? Object.assign({}, db.prepare('SELECT * FROM items WHERE id = ?').get(char.armor_id))
    : null;

  const isRanged    = weapon && weapon.weapon_type === 'ranged';
  const weaponDmg   = weapon ? (Number(weapon.damage)  || 0) : 0;
  const armorDef    = armor  ? (Number(armor.defense)  || 0) : 0;

  const maxHp       = calcMaxHp(level, vit);
  const damage      = Math.max(1, 1 + Math.floor((isRanged ? dex : str) / 3) + weaponDmg);
  const hitChance   = Math.min(95, 60 + Math.floor(dex / 2));
  const dodgeChance = Math.min(50, Math.floor(agi / 2));
  const defense     = Math.floor(res / 3) + armorDef;

  return { maxHp, damage, hitChance, dodgeChance, defense, isRanged, weaponDmg, armorDef };
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
    SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon,
           i.damage, i.defense, i.weapon_type
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

// ── Tavern: time-based HP regen ─────────────────────────────────────────────

function applyTavernTick(char) {
  const now = Math.floor(Date.now() / 1000);
  const lastTick = char.last_tick_at || char.activity_started_at || now;
  const elapsed = Math.max(0, now - lastTick);

  let { xp, xp_to_next, level, hp, unspent_points } = char;
  const vitality = Number(char.attr_vitality) || 5;
  xp = Number(xp); level = Number(level); hp = Number(hp);

  const max_hp = calcMaxHp(level, vitality);
  if (char.activity === 'tavern') {
    hp = Math.min(max_hp, hp + (TAVERN_HP_RATE * elapsed) / 60);
  }

  const leveled = levelUp({ xp, xp_to_next, level, hp, unspent_points, attr_vitality: vitality });
  return { ...leveled, last_tick_at: now };
}

// POST /api/game/:characterId/start  (tavern or farm)
router.post('/:characterId/start', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  const { action } = req.body;
  if (!['tavern', 'farm'].includes(action)) {
    return res.status(400).json({ error: 'Use /dungeon/enter to start a dungeon run' });
  }
  if (action === 'farm' && (Number(char.level) || 1) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }
  if (char.activity) {
    return res.status(400).json({ error: 'Already in an activity' });
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE characters SET activity = ?, activity_started_at = ?, last_tick_at = ?
    WHERE id = ?
  `).run(action, now, now, char.id);

  res.json(fullChar(char.id));
});

// POST /api/game/:characterId/stop
router.post('/:characterId/stop', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  if (char.activity === 'tavern') {
    const upd = applyTavernTick(char);
    db.prepare(`
      UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
        unspent_points = ?, activity = NULL, activity_started_at = NULL, last_tick_at = ?
      WHERE id = ?
    `).run(upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
           upd.unspent_points, upd.last_tick_at, char.id);
  } else {
    db.prepare(`
      UPDATE characters SET activity = NULL, activity_started_at = NULL, last_tick_at = ?
      WHERE id = ?
    `).run(Math.floor(Date.now() / 1000), char.id);
  }

  res.json(fullChar(char.id));
});

// GET /api/game/:characterId/tick  (tavern HP regen tick + harvest)
router.get('/:characterId/tick', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  harvestFarm(char.id);

  if (char.activity !== 'tavern') {
    return res.json({ ...fullChar(char.id) });
  }

  const upd = applyTavernTick(char);
  db.prepare(`
    UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
      unspent_points = ?, last_tick_at = ?
    WHERE id = ?
  `).run(upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
         upd.unspent_points, upd.last_tick_at, char.id);

  res.json({ ...fullChar(char.id) });
});

// ── Dungeon Battle System ───────────────────────────────────────────────────

// GET /api/game/:characterId/stats
router.get('/:characterId/stats', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;
  res.json(combatStats(char));
});

// POST /api/game/:characterId/dungeon/enter
// body: { level: 1-10 }
router.post('/:characterId/dungeon/enter', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  if (char.activity) {
    return res.status(400).json({ error: 'Stop your current activity first' });
  }
  const existingRun = db.prepare('SELECT id FROM dungeon_run WHERE character_id = ?').get(char.id);
  if (existingRun) {
    return res.status(400).json({ error: 'Already in a dungeon run. Flee first.' });
  }

  const requestedLevel = Number(req.body.level);
  if (!requestedLevel || requestedLevel < 1 || requestedLevel > 10) {
    return res.status(400).json({ error: 'level must be 1-10' });
  }
  const mastery = Number(char.dungeon_mastery) || 0;
  if (requestedLevel > mastery + 1) {
    return res.status(400).json({ error: `Complete dungeon level ${mastery + 1} first` });
  }

  const monster = Object.assign({}, db.prepare(
    'SELECT * FROM monsters WHERE dungeon_level = ? AND is_boss = 0'
  ).get(requestedLevel));
  if (!monster || !monster.id) {
    return res.status(500).json({ error: 'Monster data missing' });
  }

  const now = Math.floor(Date.now() / 1000);
  transaction(() => {
    db.prepare(`
      INSERT INTO dungeon_run (character_id, dungeon_level, kills, monster_id, monster_hp, started_at)
      VALUES (?, ?, 0, ?, ?, ?)
    `).run(char.id, requestedLevel, monster.id, monster.hp, now);
    db.prepare(`
      UPDATE characters SET activity = 'dungeon', activity_started_at = ?, last_tick_at = ?
      WHERE id = ?
    `).run(now, now, char.id);
  });

  res.json(fullChar(char.id));
});

// POST /api/game/:characterId/dungeon/flee
router.post('/:characterId/dungeon/flee', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  transaction(() => {
    db.prepare('DELETE FROM dungeon_run WHERE character_id = ?').run(char.id);
    db.prepare(`
      UPDATE characters SET activity = NULL, activity_started_at = NULL, last_tick_at = ?
      WHERE id = ?
    `).run(Math.floor(Date.now() / 1000), char.id);
  });

  res.json(fullChar(char.id));
});

// POST /api/game/:characterId/dungeon/attack
// Resolves a full fight against the current monster
router.post('/:characterId/dungeon/attack', (req, res) => {
  const char = ownedChar(req, res);
  if (!char) return;

  const run = db.prepare('SELECT * FROM dungeon_run WHERE character_id = ?').get(char.id);
  if (!run) {
    return res.status(400).json({ error: 'No active dungeon run' });
  }

  const monster  = Object.assign({}, db.prepare('SELECT * FROM monsters WHERE id = ?').get(run.monster_id));
  const pStats   = combatStats(char);
  let playerHp   = Number(char.hp);
  let monsterHp  = Number(run.monster_hp);
  const combatLog = [];
  let rounds = 0;

  // Fight until one side falls (max 300 rounds safety cap)
  while (monsterHp > 0 && playerHp > 0 && rounds < 300) {
    rounds++;
    const roundLog = [];

    // Player attacks monster
    if (Math.random() * 100 < pStats.hitChance) {
      const variance = Math.floor(Math.random() * 3) - 1;
      const dealt    = Math.max(1, pStats.damage + variance - monster.defense);
      monsterHp -= dealt;
      roundLog.push({ by: 'player', type: 'hit', damage: dealt });
    } else {
      roundLog.push({ by: 'player', type: 'miss' });
    }

    // Monster counter-attacks if alive
    if (monsterHp > 0) {
      if (Math.random() * 100 < pStats.dodgeChance) {
        roundLog.push({ by: 'monster', type: 'dodge' });
      } else {
        const dealt = Math.max(1, monster.damage - pStats.defense);
        playerHp  -= dealt;
        roundLog.push({ by: 'monster', type: 'hit', damage: dealt });
      }
    }

    combatLog.push(roundLog);
  }

  monsterHp = Math.max(0, monsterHp);
  playerHp  = Math.max(0, playerHp);

  // ── Player died ────────────────────────────────────────────────────────────
  if (playerHp <= 0) {
    transaction(() => {
      db.prepare('DELETE FROM dungeon_run WHERE character_id = ?').run(char.id);
      db.prepare(`
        UPDATE characters SET hp = 1, activity = NULL, activity_started_at = NULL,
          last_tick_at = ? WHERE id = ?
      `).run(Math.floor(Date.now() / 1000), char.id);
    });
    return res.json({ result: 'defeat', combatLog, char: fullChar(char.id) });
  }

  // ── Monster died ───────────────────────────────────────────────────────────
  if (monsterHp <= 0) {
    const gainedXp = monster.xp_reward;
    const afterXp  = levelUp({
      xp: Number(char.xp) + gainedXp,
      xp_to_next: Number(char.xp_to_next),
      level: Number(char.level),
      hp: playerHp,
      unspent_points: Number(char.unspent_points) || 0,
      attr_vitality: Number(char.attr_vitality) || 5,
    });

    // Roll loot drop
    let droppedItem = null;
    if (monster.drop_item_id && Math.random() * 100 < monster.drop_chance) {
      droppedItem = Object.assign({}, db.prepare('SELECT * FROM items WHERE id = ?').get(monster.drop_item_id));
      const existing = db.prepare(
        'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?'
      ).get(char.id, monster.drop_item_id);
      if (existing) {
        db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(existing.id);
      } else {
        db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)')
          .run(char.id, monster.drop_item_id);
      }
    }

    const newKills  = Number(run.kills) + 1;
    const isBossKill = monster.is_boss === 1;

    // Boss defeated → run complete
    if (isBossKill) {
      const newMastery = Math.max(Number(char.dungeon_mastery) || 0, run.dungeon_level);
      transaction(() => {
        db.prepare('DELETE FROM dungeon_run WHERE character_id = ?').run(char.id);
        db.prepare(`
          UPDATE characters SET
            xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
            unspent_points = ?, dungeon_mastery = ?,
            activity = NULL, activity_started_at = NULL, last_tick_at = ?
          WHERE id = ?
        `).run(
          afterXp.xp, afterXp.xp_to_next, afterXp.level, afterXp.max_hp, afterXp.hp,
          afterXp.unspent_points, newMastery,
          Math.floor(Date.now() / 1000), char.id
        );
      });
      return res.json({ result: 'run_complete', gainedXp, droppedItem, combatLog, newMastery, char: fullChar(char.id) });
    }

    // Regular monster killed — advance to next
    const bossSpawned = newKills >= KILLS_FOR_BOSS;
    const nextMonster = Object.assign({}, db.prepare(
      'SELECT * FROM monsters WHERE dungeon_level = ? AND is_boss = ?'
    ).get(run.dungeon_level, bossSpawned ? 1 : 0));

    transaction(() => {
      db.prepare(
        'UPDATE dungeon_run SET kills = ?, monster_id = ?, monster_hp = ? WHERE character_id = ?'
      ).run(newKills, nextMonster.id, nextMonster.hp, char.id);
      db.prepare(`
        UPDATE characters SET
          xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
          unspent_points = ?, last_tick_at = ?
        WHERE id = ?
      `).run(
        afterXp.xp, afterXp.xp_to_next, afterXp.level, afterXp.max_hp, afterXp.hp,
        afterXp.unspent_points, Math.floor(Date.now() / 1000), char.id
      );
    });

    return res.json({ result: 'monster_killed', gainedXp, droppedItem, combatLog, kills: newKills, bossSpawned, char: fullChar(char.id) });
  }

  // Both alive after MAX_ROUNDS (shouldn't happen, persist state)
  transaction(() => {
    db.prepare('UPDATE dungeon_run SET monster_hp = ? WHERE character_id = ?').run(monsterHp, char.id);
    db.prepare('UPDATE characters SET hp = ?, last_tick_at = ? WHERE id = ?')
      .run(playerHp, Math.floor(Date.now() / 1000), char.id);
  });
  res.json({ result: 'ongoing', combatLog, char: fullChar(char.id) });
});

module.exports = router;
