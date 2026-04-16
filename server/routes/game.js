'use strict';
const express = require('express');
const { client } = require('../db');
const protect = require('../middleware/protect');
const { fullChar } = require('../helpers');

// item_id -> HP restored (farm plants)
const PLANT_ITEM_HP = { 6: 2, 7: 1 };
const KILLS_FOR_BOSS = 100;
const TAVERN_HP_RATE = 2; // HP/min
const POINTS_PER_LEVEL = 5;

const SET_UNLOCK_LEVEL = { 1: 1, 2: 20, 3: 30, 4: 40, 5: 50 };
const MASTERY_COL = {
  1: 'dungeon_mastery',
  2: 'dungeon_mastery_s2',
  3: 'dungeon_mastery_s3',
  4: 'dungeon_mastery_s4',
  5: 'dungeon_mastery_s5',
};

// Move any ready farm_queue entries into the regular inventory
async function harvestFarm(charId) {
  const PLANT_ITEM_IDS = { carrot: 6, apple: 7 };
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

async function progressFarmCountdown(char, nowTs) {
  if (char.activity !== 'farm') return;

  const lastTick = Number(char.last_tick_at) || Number(char.activity_started_at) || nowTs;
  const elapsed = Math.max(0, nowTs - lastTick);
  if (elapsed <= 0) return;

  await client.execute({
    sql: `UPDATE farm_queue
          SET remaining_seconds = MAX(0, COALESCE(remaining_seconds, 0) - ?),
              ready_at = ? + MAX(0, COALESCE(remaining_seconds, 0) - ?),
              last_progress_at = ?
          WHERE character_id = ?`,
    args: [elapsed, nowTs, elapsed, nowTs, char.id],
  });
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

const READING_POINT_INTERVAL = 30 * 60; // 30 min in seconds
const READING_MAX_DURATION   = 60 * 60; // 1 hour in seconds

// Derive combat stats from character row (requires equipment DB lookups)
async function combatStats(char) {
  const str = Number(char.attr_strength)   || 5;
  const dex = Number(char.attr_dexterity)  || 5;
  const agi = Number(char.attr_agility)    || 5;
  const vit = Number(char.attr_vitality)   || 5;
  const res = Number(char.attr_resistance) || 5;
  const level = Number(char.level) || 1;

  const [weapR, armR, shieldR] = await Promise.all([
    char.weapon_id ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.weapon_id] }) : Promise.resolve({ rows: [null] }),
    char.armor_id  ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.armor_id] })  : Promise.resolve({ rows: [null] }),
    char.shield_id ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.shield_id] }) : Promise.resolve({ rows: [null] }),
  ]);
  const weapon = weapR.rows[0] ? Object.assign({}, weapR.rows[0]) : null;
  const armor  = armR.rows[0]  ? Object.assign({}, armR.rows[0])  : null;
  const shield = shieldR.rows[0] ? Object.assign({}, shieldR.rows[0]) : null;

  const isRanged    = weapon && weapon.weapon_type === 'ranged';
  const weaponDmg   = weapon ? (Number(weapon.damage)  || 0) : 0;
  const armorDef    = armor  ? (Number(armor.defense)  || 0) : 0;
  const shieldDef   = shield ? (Number(shield.defense) || 0) : 0;

  const maxHp       = calcMaxHp(level, vit);
  const damage      = Math.max(1, 1 + Math.floor((isRanged ? dex : str) / 3) + weaponDmg);
  const hitChance   = Math.min(95, 60 + Math.floor(dex / 2));
  const dodgeChance = Math.min(50, Math.floor(agi / 2));
  const defense     = Math.floor(res / 3) + armorDef + shieldDef;

  return { maxHp, damage, hitChance, dodgeChance, defense, isRanged, weaponDmg, armorDef, shieldDef };
}

async function rollRandomGearDrop(monster) {
  const isBoss = Number(monster.is_boss) === 1;
  const configuredChance = Number(monster.drop_chance) || 0;
  // Keep drops rare while still rewarding bosses more often.
  const finalChance = Math.min(18, Math.max(isBoss ? 7 : 3, Math.floor(configuredChance / 3) + (isBoss ? 4 : 1)));
  if (Math.random() * 100 >= finalChance) return null;

  const level = Number(monster.dungeon_level) || 1;
  const maxStat = Math.max(3, level * 2 + (isBoss ? 3 : 0));

  const allGearR = await client.execute({
    sql: `SELECT *
          FROM items
          WHERE (type = 'weapon' AND damage > 0 AND damage <= ?)
             OR (type = 'armor'  AND defense > 0 AND defense <= ?)
          ORDER BY id ASC`,
    args: [maxStat, maxStat],
  });
  let gear = allGearR.rows.map(row => Object.assign({}, row));

  if (!gear.length) {
    const fallbackR = await client.execute({
      sql: `SELECT * FROM items WHERE type = 'weapon' OR type = 'armor' ORDER BY id ASC`,
      args: [],
    });
    gear = fallbackR.rows.map(row => Object.assign({}, row));
  }
  if (!gear.length) return null;

  const desiredSlot = ['weapon', 'body', 'shield'][Math.floor(Math.random() * 3)];
  const slotPool = gear.filter(item => {
    if (desiredSlot === 'weapon') return item.type === 'weapon';
    if (desiredSlot === 'shield') return item.type === 'armor' && (item.armor_slot || 'body') === 'shield';
    return item.type === 'armor' && (item.armor_slot || 'body') === 'body';
  });
  const pool = slotPool.length ? slotPool : gear;

  return pool[Math.floor(Math.random() * pool.length)] || null;
}

// Apply reading tick (awards attr points over time, auto-stops at 1h)
function applyReadingTick(char) {
  const now = Math.floor(Date.now() / 1000);
  let { xp, xp_to_next, level, hp, unspent_points } = char;
  const vitality = Number(char.attr_vitality) || 5;
  let reading_points_awarded = Number(char.reading_points_awarded) || 0;
  let readingFinished = false;

  const totalElapsed = Math.max(0, now - (char.activity_started_at || now));
  const pointsDue = Math.min(2, Math.floor(totalElapsed / READING_POINT_INTERVAL));
  const newPoints = pointsDue - reading_points_awarded;
  if (newPoints > 0) {
    unspent_points += newPoints;
    reading_points_awarded = pointsDue;
  }
  if (totalElapsed >= READING_MAX_DURATION) {
    readingFinished = true;
  }

  const leveled = levelUp({ xp, xp_to_next, level, hp, unspent_points, attr_vitality: vitality });
  return { ...leveled, last_tick_at: now, reading_points_awarded, readingFinished };
}

async function ownedChar(req, res) {
  const r = await client.execute({
    sql:  'SELECT * FROM characters WHERE id = ? AND user_id = ?',
    args: [req.params.characterId, req.user.userId],
  });
  const char = r.rows[0] ?? null;
  if (!char) res.status(404).json({ error: 'Character not found' });
  return char ? Object.assign({}, char) : null;
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
router.post('/:characterId/start', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const { action } = req.body;
  if (!['tavern', 'farm', 'reading'].includes(action)) {
    return res.status(400).json({ error: 'Use /dungeon/enter to start a dungeon run' });
  }
  if (action === 'farm' && (Number(char.level) || 1) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }
  if (char.activity) {
    return res.status(400).json({ error: 'Already in an activity' });
  }

  const now = Math.floor(Date.now() / 1000);
  await client.execute({
    sql:  `UPDATE characters SET activity = ?, activity_started_at = ?, last_tick_at = ?,
           reading_points_awarded = 0 WHERE id = ?`,
    args: [action, now, now, char.id],
  });

  res.json(await fullChar(char.id));
});

// POST /api/game/:characterId/stop
router.post('/:characterId/stop', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  if (char.activity === 'tavern') {
    const upd = applyTavernTick(char);
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, activity = NULL, activity_started_at = NULL,
             reading_points_awarded = 0, last_tick_at = ? WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.last_tick_at, char.id],
    });
  } else if (char.activity === 'reading') {
    const upd = applyReadingTick(char);
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, activity = NULL, activity_started_at = NULL,
             reading_points_awarded = 0, last_tick_at = ? WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.last_tick_at, char.id],
    });
  } else {
    await client.execute({
      sql:  `UPDATE characters SET activity = NULL, activity_started_at = NULL,
             reading_points_awarded = 0, last_tick_at = ? WHERE id = ?`,
      args: [Math.floor(Date.now() / 1000), char.id],
    });
  }

  res.json(await fullChar(char.id));
});

// GET /api/game/:characterId/tick  (tavern HP regen tick + harvest)
router.get('/:characterId/tick', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const now = Math.floor(Date.now() / 1000);
  await progressFarmCountdown(char, now);
  await harvestFarm(char.id);

  if (char.activity === 'tavern') {
    const upd = applyTavernTick(char);
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, last_tick_at = ? WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.last_tick_at, char.id],
    });
  } else if (char.activity === 'reading') {
    const upd = applyReadingTick(char);
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, reading_points_awarded = ?, last_tick_at = ?
             ${upd.readingFinished ? ', activity = NULL, activity_started_at = NULL' : ''}
             WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.reading_points_awarded, upd.last_tick_at, char.id],
    });
    return res.json({ ...await fullChar(char.id), readingFinished: upd.readingFinished });
  } else if (char.activity === 'farm') {
    await client.execute({
      sql:  'UPDATE characters SET last_tick_at = ? WHERE id = ?',
      args: [now, char.id],
    });
  }

  res.json(await fullChar(char.id));
});

// ── Dungeon Battle System ───────────────────────────────────────────────────

// GET /api/game/:characterId/stats
router.get('/:characterId/stats', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;
  res.json(await combatStats(char));
});

// POST /api/game/:characterId/dungeon/enter
// body: { level: 1-10, set: 1-5 }
router.post('/:characterId/dungeon/enter', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  if (char.activity) {
    return res.status(400).json({ error: 'Stop your current activity first' });
  }
  const existR = await client.execute({
    sql:  'SELECT id FROM dungeon_run WHERE character_id = ?',
    args: [char.id],
  });
  if (existR.rows.length) {
    return res.status(400).json({ error: 'Already in a dungeon run. Flee first.' });
  }

  const requestedLevel = Number(req.body.level);
  if (!requestedLevel || requestedLevel < 1 || requestedLevel > 10) {
    return res.status(400).json({ error: 'level must be 1-10' });
  }

  const requestedSet = Number(req.body.set) || 1;
  if (!SET_UNLOCK_LEVEL[requestedSet]) {
    return res.status(400).json({ error: 'set must be 1-5' });
  }
  const charLevel = Number(char.level) || 1;
  if (charLevel < SET_UNLOCK_LEVEL[requestedSet]) {
    return res.status(403).json({ error: `Dungeon Set ${requestedSet} unlocks at level ${SET_UNLOCK_LEVEL[requestedSet]}` });
  }

  const masteryCol = MASTERY_COL[requestedSet];
  const mastery = Number(char[masteryCol]) || 0;
  if (requestedLevel > mastery + 1) {
    return res.status(400).json({ error: `Complete dungeon level ${mastery + 1} first` });
  }

  const monR = await client.execute({
    sql:  'SELECT * FROM monsters WHERE dungeon_set = ? AND dungeon_level = ? AND is_boss = 0',
    args: [requestedSet, requestedLevel],
  });
  const monster = monR.rows[0] ? Object.assign({}, monR.rows[0]) : null;
  if (!monster || !monster.id) {
    return res.status(500).json({ error: 'Monster data missing' });
  }

  const now = Math.floor(Date.now() / 1000);
  await client.batch([
    {
      sql:  `INSERT INTO dungeon_run (character_id, dungeon_level, dungeon_set, kills, monster_id, monster_hp, started_at)
             VALUES (?, ?, ?, 0, ?, ?, ?)`,
      args: [char.id, requestedLevel, requestedSet, monster.id, monster.hp, now],
    },
    {
      sql:  `UPDATE characters SET activity = 'dungeon', activity_started_at = ?, last_tick_at = ? WHERE id = ?`,
      args: [now, now, char.id],
    },
  ], 'write');

  res.json(await fullChar(char.id));
});

// POST /api/game/:characterId/dungeon/flee
router.post('/:characterId/dungeon/flee', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  await client.batch([
    { sql: 'DELETE FROM dungeon_run WHERE character_id = ?',                         args: [char.id] },
    { sql: `UPDATE characters SET activity = NULL, activity_started_at = NULL, last_tick_at = ? WHERE id = ?`, args: [Math.floor(Date.now() / 1000), char.id] },
  ], 'write');

  res.json(await fullChar(char.id));
});

// POST /api/game/:characterId/dungeon/attack
// Resolves a full fight against the current monster
router.post('/:characterId/dungeon/attack', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const runR = await client.execute({
    sql:  'SELECT * FROM dungeon_run WHERE character_id = ?',
    args: [char.id],
  });
  const run = runR.rows[0] ? Object.assign({}, runR.rows[0]) : null;
  if (!run) {
    return res.status(400).json({ error: 'No active dungeon run' });
  }

  const monR = await client.execute({ sql: 'SELECT * FROM monsters WHERE id = ?', args: [run.monster_id] });
  const monster  = Object.assign({}, monR.rows[0]);
  const pStats   = await combatStats(char);
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
    await client.batch([
      { sql: 'DELETE FROM dungeon_run WHERE character_id = ?', args: [char.id] },
      { sql: `UPDATE characters SET hp = 1, activity = NULL, activity_started_at = NULL, last_tick_at = ? WHERE id = ?`, args: [Math.floor(Date.now() / 1000), char.id] },
    ], 'write');
    return res.json({ result: 'defeat', combatLog, char: await fullChar(char.id) });
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

    // Roll random gear drop (rare by design).
    let droppedItem = await rollRandomGearDrop(monster);
    if (droppedItem) {
      const existR = await client.execute({
        sql:  'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
        args: [char.id, droppedItem.id],
      });
      const existing = existR.rows[0] ?? null;
      if (existing) {
        await client.execute({ sql: 'UPDATE inventory SET quantity = quantity + 1 WHERE id = ?', args: [existing.id] });
      } else {
        await client.execute({
          sql:  'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)',
          args: [char.id, droppedItem.id],
        });
      }
    }

    const newKills  = Number(run.kills) + 1;
    const isBossKill = monster.is_boss === 1;

    // Boss defeated → run complete
    if (isBossKill) {
      const dungeonSet  = Number(run.dungeon_set) || 1;
      const masteryCol  = MASTERY_COL[dungeonSet] || 'dungeon_mastery';
      const newMastery = Math.max(Number(char[masteryCol]) || 0, run.dungeon_level);
      await client.batch([
        { sql: 'DELETE FROM dungeon_run WHERE character_id = ?', args: [char.id] },
        {
          sql:  `UPDATE characters SET
                 xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
                 unspent_points = ?, ${masteryCol} = ?,
                 activity = NULL, activity_started_at = NULL, last_tick_at = ?
                 WHERE id = ?`,
          args: [afterXp.xp, afterXp.xp_to_next, afterXp.level, afterXp.max_hp, afterXp.hp,
                 afterXp.unspent_points, newMastery, Math.floor(Date.now() / 1000), char.id],
        },
      ], 'write');
      return res.json({ result: 'run_complete', gainedXp, droppedItem, combatLog, newMastery, char: await fullChar(char.id) });
    }

    // Regular monster killed — advance to next
    const bossSpawned = newKills >= KILLS_FOR_BOSS;
    const dungeonSet  = Number(run.dungeon_set) || 1;
    const nextMonR = await client.execute({
      sql:  'SELECT * FROM monsters WHERE dungeon_set = ? AND dungeon_level = ? AND is_boss = ?',
      args: [dungeonSet, run.dungeon_level, bossSpawned ? 1 : 0],
    });
    const nextMonster = Object.assign({}, nextMonR.rows[0]);

    await client.batch([
      {
        sql:  'UPDATE dungeon_run SET kills = ?, monster_id = ?, monster_hp = ? WHERE character_id = ?',
        args: [newKills, nextMonster.id, nextMonster.hp, char.id],
      },
      {
        sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
               unspent_points = ?, last_tick_at = ? WHERE id = ?`,
        args: [afterXp.xp, afterXp.xp_to_next, afterXp.level, afterXp.max_hp, afterXp.hp,
               afterXp.unspent_points, Math.floor(Date.now() / 1000), char.id],
      },
    ], 'write');

    return res.json({ result: 'monster_killed', gainedXp, droppedItem, combatLog, kills: newKills, bossSpawned, char: await fullChar(char.id) });
  }

  // Both alive after MAX_ROUNDS (shouldn't happen, persist state)
  await client.batch([
    { sql: 'UPDATE dungeon_run SET monster_hp = ? WHERE character_id = ?',        args: [monsterHp, char.id] },
    { sql: 'UPDATE characters SET hp = ?, last_tick_at = ? WHERE id = ?', args: [playerHp, Math.floor(Date.now() / 1000), char.id] },
  ], 'write');
  res.json({ result: 'ongoing', combatLog, char: await fullChar(char.id) });
});

module.exports = router;
