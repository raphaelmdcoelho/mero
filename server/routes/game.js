'use strict';
const express = require('express');
const { client } = require('../db');
const protect = require('../middleware/protect');
const { fullChar } = require('../helpers');

// item_id -> HP restored (farm plants)
const PLANT_ITEM_HP = { 6: 2, 7: 1 };
const POINTS_PER_LEVEL = 5;

const TAVERN_REST_TYPES = {
  relax:    { staminaRate: 1, cost: 10 },
  break:    { staminaRate: 3, cost: 30 },
  recovery: { staminaRate: 6, cost: 70 },
};

const SET_UNLOCK_LEVEL = { 1: 1, 2: 20, 3: 30, 4: 40, 5: 50, 6: 5, 7: 10, 8: 15 };
const MASTERY_COL = {
  1: 'dungeon_mastery',
  2: 'dungeon_mastery_s2',
  3: 'dungeon_mastery_s3',
  4: 'dungeon_mastery_s4',
  5: 'dungeon_mastery_s5',
  6: 'dungeon_mastery_s6',
  7: 'dungeon_mastery_s7',
  8: 'dungeon_mastery_s8',
};

const DUNGEON_DIFFICULTY = {
  easy:   { staminaCost: 2, durationMs: 2 * 60 * 1000 },
  medium: { staminaCost: 4, durationMs: 3 * 60 * 1000 },
  hard:   { staminaCost: 7, durationMs: 5 * 60 * 1000 },
};

// Stamina regen: 1 point per 10 minutes (600 seconds)
const STAMINA_REGEN_INTERVAL = 600;

// Move any ready farm_queue entries into the regular inventory
async function harvestFarm(charId) {
  const PLANT_ITEM_IDS = { carrot: 6, apple: 7, onion: 29, corn: 30 };
  const now = Math.floor(Date.now() / 1000);
  const r = await client.execute({
    sql:  'SELECT * FROM farm_queue WHERE character_id = ? AND ready_at <= ?',
    args: [charId, now],
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

function calcMaxHp(level, vitality) {
  return 10 + (level - 1) * 5 + vitality * 2;
}

function calcMaxStamina(level, attrStamina) {
  return 5 + (attrStamina || 5) + Math.floor((level - 1) / 5);
}

function levelUp(char) {
  let { xp, xp_to_next, level, hp, unspent_points } = char;
  const vitality    = Number(char.attr_vitality) || 5;
  const attrStamina = Number(char.attr_stamina)  || 5;
  unspent_points = Number(unspent_points) || 0;
  let leveled = false;
  while (xp >= xp_to_next) {
    xp -= xp_to_next;
    level += 1;
    xp_to_next = Math.floor(10 * Math.pow(1.5, level - 1));
    unspent_points += POINTS_PER_LEVEL;
    leveled = true;
  }
  const max_hp      = calcMaxHp(level, vitality);
  const max_stamina = calcMaxStamina(level, attrStamina);
  if (leveled) hp = max_hp;
  return { xp, xp_to_next, level, max_hp, hp: Math.min(hp, max_hp), unspent_points, max_stamina, leveled };
}

const READING_POINT_INTERVAL = 30 * 60;
const READING_MAX_DURATION   = 60 * 60;

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

// Generate loot for a completed dungeon run
// buff: parsed buff_effect object from the adventure potion, or null
async function generateLoot(run, bossXp, difficulty, actualDurationMs, totalDurationMs, buff = null) {
  const dungeonLevel = Number(run.dungeon_level) || 1;

  // XP proportional to time spent
  const timeFraction = Math.min(1, actualDurationMs / totalDurationMs);
  const diffXpMult   = { easy: 0.3, medium: 0.6, hard: 1.0 }[difficulty] || 0.3;
  let gainedXp       = Math.max(1, Math.round(bossXp * diffXpMult * timeFraction));
  if (buff?.type === 'xp_multiplier') gainedXp = Math.round(gainedXp * (buff.value || 2));

  // Loot count based on difficulty (+ abundance buff)
  const lootCountRange = { easy: [1, 2], medium: [1, 3], hard: [2, 4] }[difficulty] || [1, 2];
  let lootCount = lootCountRange[0] + Math.floor(Math.random() * (lootCountRange[1] - lootCountRange[0] + 1));
  if (buff?.type === 'loot_count') lootCount += Number(buff.value) || 0;

  // Gear quality ceiling (fortune brew doubles the stat cap)
  let maxStat = Math.max(3, dungeonLevel * 2);
  if (buff?.type === 'loot_quality') maxStat = Math.max(3, dungeonLevel * 2 * (buff.value || 2));

  const loot = [];

  const gearR = await client.execute({
    sql: `SELECT * FROM items
          WHERE (type = 'weapon' AND damage > 0 AND damage <= ?)
             OR (type = 'armor'  AND defense > 0 AND defense <= ?)`,
    args: [maxStat, maxStat],
  });
  const gearPool = gearR.rows.map(r => Object.assign({}, r));

  const regularConsumables = [
    { type: 'consumable', name: 'Health Potion', icon: '🧪', item_id: 5 },
    { type: 'consumable', name: 'Carrot',         icon: '🥕', item_id: 6 },
    { type: 'consumable', name: 'Apple',           icon: '🍎', item_id: 7 },
  ];
  const adventurePotions = [
    { type: 'consumable', name: 'Swift Elixir',     icon: '⚡', item_id: 20 },
    { type: 'consumable', name: 'Fortune Brew',     icon: '🍀', item_id: 21 },
    { type: 'consumable', name: 'Abundance Tonic',  icon: '🎁', item_id: 22 },
    { type: 'consumable', name: 'Vitality Draught', icon: '💚', item_id: 23 },
    { type: 'consumable', name: 'Wisdom Potion',    icon: '📚', item_id: 24 },
  ];

  for (let i = 0; i < lootCount; i++) {
    const isConsumable = Math.random() < 0.5 || !gearPool.length;
    if (isConsumable) {
      // 25% chance for an adventure potion drop, 75% regular consumable
      const pool = Math.random() < 0.25 ? adventurePotions : regularConsumables;
      const c = pool[Math.floor(Math.random() * pool.length)];
      const qty = 1 + Math.floor(Math.random() * 2);
      loot.push({ type: c.type, name: c.name, icon: c.icon, item_id: c.item_id, quantity: qty });
    } else {
      const gear = gearPool[Math.floor(Math.random() * gearPool.length)];
      loot.push({ type: gear.type, name: gear.name, icon: gear.icon, item_id: gear.id, quantity: 1 });
    }
  }

  return { gainedXp, loot };
}

// Award loot items to character inventory
async function awardLoot(charId, loot) {
  for (const item of loot) {
    const existR = await client.execute({
      sql:  'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
      args: [charId, item.item_id],
    });
    const existing = existR.rows[0] ?? null;
    if (existing) {
      await client.execute({
        sql:  'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
        args: [item.quantity, existing.id],
      });
    } else {
      await client.execute({
        sql:  'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, ?)',
        args: [charId, item.item_id, item.quantity],
      });
    }
  }
}

// Complete a dungeon run: award XP + loot, clear the run
async function completeDungeonRun(char, run, forced) {
  const difficulty    = run.difficulty || 'easy';
  const startedAt     = Number(run.started_at) || 0;
  const nowMs         = Date.now();
  const totalDuration = DUNGEON_DIFFICULTY[difficulty]?.durationMs || DUNGEON_DIFFICULTY.easy.durationMs;
  const actualMs      = forced
    ? Math.max(0, nowMs - startedAt * 1000)
    : totalDuration;

  // Load potion buff if one was equipped for this run
  let buff = null;
  let potionItemId = run.potion_item_id ? Number(run.potion_item_id) : null;
  if (potionItemId) {
    const potionR = await client.execute({
      sql:  'SELECT buff_effect FROM items WHERE id = ?',
      args: [potionItemId],
    });
    const rawBuff = potionR.rows[0]?.buff_effect;
    if (rawBuff) {
      try { buff = JSON.parse(rawBuff); } catch { /* ignore malformed */ }
    }
    // Consume the potion from inventory
    const invR = await client.execute({
      sql:  'SELECT id, quantity FROM inventory WHERE character_id = ? AND item_id = ?',
      args: [char.id, potionItemId],
    });
    const invRow = invR.rows[0] ?? null;
    if (invRow) {
      if (Number(invRow.quantity) <= 1) {
        await client.execute({ sql: 'DELETE FROM inventory WHERE id = ?', args: [invRow.id] });
      } else {
        await client.execute({ sql: 'UPDATE inventory SET quantity = quantity - 1 WHERE id = ?', args: [invRow.id] });
      }
    }
  }

  const dungeonSet   = Number(run.dungeon_set) || 1;
  const dungeonLevel = Number(run.dungeon_level) || 1;
  const bossR = await client.execute({
    sql:  'SELECT xp_reward FROM monsters WHERE dungeon_set = ? AND dungeon_level = ? AND is_boss = 1',
    args: [dungeonSet, dungeonLevel],
  });
  const bossXp = bossR.rows[0] ? Number(bossR.rows[0].xp_reward) : 100;

  const { gainedXp, loot } = await generateLoot(run, bossXp, difficulty, actualMs, totalDuration, buff);

  const timeFraction   = totalDuration > 0 ? Math.min(1, actualMs / totalDuration) : 1;
  const diffGoldMult   = { easy: 5, medium: 10, hard: 18 }[difficulty] || 5;
  const gainedGold     = Math.max(1, Math.round(dungeonLevel * dungeonSet * timeFraction * diffGoldMult));

  const afterXp = levelUp({
    xp: Number(char.xp) + gainedXp,
    xp_to_next: Number(char.xp_to_next),
    level: Number(char.level),
    hp: Number(char.hp),
    unspent_points: Number(char.unspent_points) || 0,
    attr_vitality: Number(char.attr_vitality) || 5,
    attr_stamina:  Number(char.attr_stamina)  || 5,
  });

  // Restore stamina to full on level-up; apply stamina buff; keep current otherwise
  let newStamina = afterXp.leveled ? afterXp.max_stamina : (Number(char.stamina) || 0);
  if (!afterXp.leveled && buff?.type === 'stamina') {
    newStamina = Math.min(afterXp.max_stamina, newStamina + (Number(buff.value) || 0));
  }

  await awardLoot(char.id, loot);

  const masteryCol = MASTERY_COL[dungeonSet] || 'dungeon_mastery';
  const currentMastery = Number(char[masteryCol]) || 0;
  // Only update mastery when the run completes naturally (timer reached 0)
  const newMastery = forced ? currentMastery : Math.max(currentMastery, dungeonLevel);

  const nowSec = Math.floor(nowMs / 1000);
  await client.batch([
    { sql: 'DELETE FROM dungeon_run WHERE character_id = ?', args: [char.id] },
    {
      sql: `UPDATE characters SET
              xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
              unspent_points = ?, ${masteryCol} = ?,
              stamina = ?, max_stamina = ?,
              gold = gold + ?,
              activity = NULL, activity_started_at = NULL, last_tick_at = ?
            WHERE id = ?`,
      args: [
        afterXp.xp, afterXp.xp_to_next, afterXp.level, afterXp.max_hp, afterXp.hp,
        afterXp.unspent_points, newMastery,
        newStamina, afterXp.max_stamina,
        gainedGold,
        nowSec, char.id,
      ],
    },
  ], 'write');

  return { gainedXp, loot, newMastery, forced, buff, potionItemId, gainedGold };
}

function applyReadingTick(char) {
  const now = Math.floor(Date.now() / 1000);
  let { xp, xp_to_next, level, hp, unspent_points, stamina } = char;
  const vitality    = Number(char.attr_vitality) || 5;
  const attrStamina = Number(char.attr_stamina)  || 5;
  let reading_points_awarded = Number(char.reading_points_awarded) || 0;
  let readingFinished = false;

  const totalElapsed = Math.max(0, now - (char.activity_started_at || now));

  // Award 1 stamina after the full hour (tracked via reading_points_awarded)
  if (totalElapsed >= READING_MAX_DURATION && reading_points_awarded < 1) {
    const leveled = levelUp({ xp, xp_to_next, level, hp, unspent_points, attr_vitality: vitality, attr_stamina: attrStamina });
    const maxSt = leveled.max_stamina;
    stamina = Math.min(maxSt, (Number(stamina) || 0) + 1);
    reading_points_awarded = 1;
    readingFinished = true;
    return { ...leveled, stamina, last_tick_at: now, reading_points_awarded, readingFinished };
  }

  if (totalElapsed >= READING_MAX_DURATION) {
    readingFinished = true;
  }

  const leveled = levelUp({ xp, xp_to_next, level, hp, unspent_points, attr_vitality: vitality, attr_stamina: attrStamina });
  return { ...leveled, stamina: Number(stamina) || 0, last_tick_at: now, reading_points_awarded, readingFinished };
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

// ── Tavern: time-based stamina regen ────────────────────────────────────────

function applyTavernTick(char) {
  const now = Math.floor(Date.now() / 1000);
  const lastTick = char.last_tick_at || char.activity_started_at || now;
  const elapsed = Math.max(0, now - lastTick);

  let { xp, xp_to_next, level, hp, unspent_points } = char;
  const vitality    = Number(char.attr_vitality) || 5;
  const attrStamina = Number(char.attr_stamina)  || 5;
  xp = Number(xp); level = Number(level);

  const upd         = levelUp({ xp, xp_to_next, level, hp, unspent_points, attr_vitality: vitality, attr_stamina: attrStamina });
  const max_stamina = upd.max_stamina;
  const restType    = TAVERN_REST_TYPES[char.rest_type] || TAVERN_REST_TYPES.relax;
  // Restore to full on level-up; otherwise accumulate regen
  const stamina     = upd.leveled
    ? max_stamina
    : Math.min(max_stamina, (Number(char.stamina) || 0) + (restType.staminaRate * elapsed) / 60);
  return { ...upd, stamina, max_stamina, last_tick_at: now };
}

// Compute stamina regen based on elapsed time since last tick
function applyStaminaRegen(char, nowSec) {
  const lastTick    = Number(char.last_tick_at) || nowSec;
  const elapsed     = Math.max(0, nowSec - lastTick);
  const attrStamina = Number(char.attr_stamina) || 5;
  const maxSt       = calcMaxStamina(Number(char.level) || 1, attrStamina);
  const regenPoints = Math.floor(elapsed / STAMINA_REGEN_INTERVAL);
  const newStamina  = Math.min(maxSt, (Number(char.stamina) || 0) + regenPoints);
  return { stamina: newStamina, max_stamina: maxSt };
}

// POST /api/game/:characterId/start  (tavern or farm)
router.post('/:characterId/start', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const { action, restType } = req.body;
  if (!['tavern', 'farm', 'reading'].includes(action)) {
    return res.status(400).json({ error: 'Use /dungeon/enter to start a dungeon run' });
  }
  if (action === 'farm' && (Number(char.level) || 1) < 3) {
    return res.status(403).json({ error: 'Farming unlocks at level 3' });
  }
  if (char.activity) {
    return res.status(400).json({ error: 'Already in an activity' });
  }

  let resolvedRestType = null;
  if (action === 'tavern') {
    if (!restType || !TAVERN_REST_TYPES[restType]) {
      return res.status(400).json({ error: 'restType must be relax, break, or recovery' });
    }
    const cost = TAVERN_REST_TYPES[restType].cost;
    const gold = Number(char.gold) || 0;
    if (gold < cost) {
      return res.status(400).json({ error: `Not enough gold (need ${cost}g, have ${gold}g)` });
    }
    resolvedRestType = restType;
    const now = Math.floor(Date.now() / 1000);
    await client.execute({
      sql:  `UPDATE characters SET activity = ?, activity_started_at = ?, last_tick_at = ?,
             reading_points_awarded = 0, rest_type = ?, gold = gold - ? WHERE id = ?`,
      args: [action, now, now, resolvedRestType, cost, char.id],
    });
    return res.json(await fullChar(char.id));
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
             unspent_points = ?, stamina = ?, max_stamina = ?,
             activity = NULL, activity_started_at = NULL,
             reading_points_awarded = 0, rest_type = NULL, last_tick_at = ? WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.stamina, upd.max_stamina,
             upd.last_tick_at, char.id],
    });
  } else if (char.activity === 'reading') {
    const upd = applyReadingTick(char);
    // stamina is only awarded on full hour completion; partial stop gives no stamina
    const stAfterRead = upd.leveled ? upd.max_stamina : upd.stamina;
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, stamina = ?, max_stamina = ?,
             activity = NULL, activity_started_at = NULL,
             reading_points_awarded = 0, last_tick_at = ? WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, stAfterRead, upd.max_stamina,
             upd.last_tick_at, char.id],
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

// GET /api/game/:characterId/tick  (tavern HP regen tick + harvest + stamina regen)
router.get('/:characterId/tick', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const now = Math.floor(Date.now() / 1000);
  await progressFarmCountdown(char, now);

  // Tavern handles its own stamina regen; idle/farm/reading use the generic slower regen
  const stRegen = (char.activity !== 'dungeon' && char.activity !== 'tavern')
    ? applyStaminaRegen(char, now)
    : null;

  if (char.activity === 'tavern') {
    const upd = applyTavernTick(char);
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, stamina = ?, max_stamina = ?, last_tick_at = ? WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.stamina, upd.max_stamina,
             upd.last_tick_at, char.id],
    });
  } else if (char.activity === 'reading') {
    const upd = applyReadingTick(char);
    // upd.stamina already has the +1 stamina applied if the hour completed
    const newSt    = upd.leveled ? upd.max_stamina : upd.stamina;
    const newMaxSt = upd.max_stamina;
    await client.execute({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, reading_points_awarded = ?, last_tick_at = ?,
             stamina = ?, max_stamina = ?
             ${upd.readingFinished ? ', activity = NULL, activity_started_at = NULL' : ''}
             WHERE id = ?`,
      args: [upd.xp, upd.xp_to_next, upd.level, upd.max_hp, upd.hp,
             upd.unspent_points, upd.reading_points_awarded, upd.last_tick_at,
             newSt, newMaxSt,
             char.id],
    });
    return res.json({ ...await fullChar(char.id), readingFinished: upd.readingFinished });
  } else if (char.activity === 'farm') {
    await client.execute({
      sql:  'UPDATE characters SET last_tick_at = ?, stamina = ?, max_stamina = ? WHERE id = ?',
      args: [now,
             stRegen ? stRegen.stamina : char.stamina,
             stRegen ? stRegen.max_stamina : char.max_stamina,
             char.id],
    });
  } else {
    // Idle or dungeon — update stamina and timestamp
    await client.execute({
      sql:  'UPDATE characters SET last_tick_at = ?, stamina = ?, max_stamina = ? WHERE id = ?',
      args: [now,
             stRegen ? stRegen.stamina : char.stamina,
             stRegen ? stRegen.max_stamina : char.max_stamina,
             char.id],
    });
  }

  res.json(await fullChar(char.id));
});

// ── Fishing ─────────────────────────────────────────────────────────────────

const FISHING_STAMINA_COST = 1;
const FISHING_BASE_XP      = 20;
// item_id → XP bonus
const FISHING_BAIT_BONUS   = { 37: 0, 38: 5, 39: 10, 40: 5 };
const FISH_ITEM_ID         = 41;

// POST /api/game/:characterId/fish
// Body: { baitItemId: number, caught: boolean }
// Always consumes 1 bait. Adds fish + XP only when caught=true.
router.post('/:characterId/fish', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  if (char.activity) {
    return res.status(400).json({ error: 'Cannot fish during another activity' });
  }

  const { baitItemId, caught } = req.body;
  const validBaits = Object.keys(FISHING_BAIT_BONUS).map(Number);
  if (!validBaits.includes(Number(baitItemId))) {
    return res.status(400).json({ error: 'Invalid bait item' });
  }

  // Verify bait is in inventory
  const invRow = await client.execute({
    sql:  'SELECT id, quantity FROM inventory WHERE character_id = ? AND item_id = ?',
    args: [char.id, baitItemId],
  });
  if (!invRow.rows.length || Number(invRow.rows[0].quantity) < 1) {
    return res.status(400).json({ error: 'Bait not found in inventory' });
  }

  const stamina = Number(char.stamina) || 0;
  if (caught && stamina < FISHING_STAMINA_COST) {
    return res.status(400).json({ error: `Not enough stamina to fish (need ${FISHING_STAMINA_COST})` });
  }

  const baitInvId  = invRow.rows[0].id;
  const baitQty    = Number(invRow.rows[0].quantity);

  // Consume 1 bait
  const consumeBait = baitQty > 1
    ? { sql: 'UPDATE inventory SET quantity = quantity - 1 WHERE id = ?', args: [baitInvId] }
    : { sql: 'DELETE FROM inventory WHERE id = ?',                        args: [baitInvId] };

  let fishXp = 0;
  const ops = [consumeBait];

  if (caught) {
    fishXp = FISHING_BASE_XP + (FISHING_BAIT_BONUS[baitItemId] ?? 0);
    const updated = levelUp({ ...char, xp: Number(char.xp) + fishXp });

    ops.push({
      sql:  `UPDATE characters SET xp = ?, xp_to_next = ?, level = ?, max_hp = ?, hp = ?,
             unspent_points = ?, stamina = ?, max_stamina = ? WHERE id = ?`,
      args: [updated.xp, updated.xp_to_next, updated.level, updated.max_hp, updated.hp,
             updated.unspent_points, stamina - FISHING_STAMINA_COST, updated.max_stamina, char.id],
    });

    // Add fish to inventory (upsert)
    const fishRow = await client.execute({
      sql:  'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
      args: [char.id, FISH_ITEM_ID],
    });
    if (fishRow.rows.length) {
      ops.push({
        sql:  'UPDATE inventory SET quantity = quantity + 1 WHERE id = ?',
        args: [fishRow.rows[0].id],
      });
    } else {
      ops.push({
        sql:  'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)',
        args: [char.id, FISH_ITEM_ID],
      });
    }
  }

  await client.batch(ops, 'write');

  res.json({ ...await fullChar(char.id), fishXp });
});

// ── Dungeon System ──────────────────────────────────────────────────────────

// GET /api/game/:characterId/stats
router.get('/:characterId/stats', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;
  res.json(await combatStats(char));
});

// POST /api/game/:characterId/dungeon/enter
// body: { level: 1-10, set: 1-5, difficulty: 'easy'|'medium'|'hard' }
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
    return res.status(400).json({ error: 'Already in a dungeon run' });
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

  const difficulty = req.body.difficulty;
  if (!difficulty || !DUNGEON_DIFFICULTY[difficulty]) {
    return res.status(400).json({ error: 'difficulty must be easy, medium, or hard' });
  }
  const diffConfig = DUNGEON_DIFFICULTY[difficulty];

  const currentStamina = Number(char.stamina) || 0;
  if (currentStamina < diffConfig.staminaCost) {
    return res.status(400).json({ error: `Not enough stamina (need ${diffConfig.staminaCost}, have ${currentStamina})` });
  }

  // Fetch a monster to satisfy the NOT NULL FK constraint (not used in the new timer system)
  const monR = await client.execute({
    sql:  'SELECT * FROM monsters WHERE dungeon_set = ? AND dungeon_level = ? AND is_boss = 0 LIMIT 1',
    args: [requestedSet, requestedLevel],
  });
  const monster = monR.rows[0] ? Object.assign({}, monR.rows[0]) : null;
  if (!monster) {
    return res.status(500).json({ error: 'Monster data missing' });
  }

  // Validate optional adventure potion
  let potionItemId = null;
  if (req.body.potion_item_id) {
    const pid = Number(req.body.potion_item_id);
    if (pid) {
      const potionItemR = await client.execute({
        sql:  `SELECT i.id, i.item_subtype, i.buff_effect
               FROM inventory inv
               JOIN items i ON i.id = inv.item_id
               WHERE inv.character_id = ? AND inv.item_id = ? AND inv.quantity > 0`,
        args: [char.id, pid],
      });
      const potionItem = potionItemR.rows[0] ?? null;
      if (!potionItem) return res.status(400).json({ error: 'Potion not in inventory' });
      if (potionItem.item_subtype !== 'adventure_potion') {
        return res.status(400).json({ error: 'Only adventure potions can be used in dungeons' });
      }
      potionItemId = pid;
    }
  }

  // Parse speed buff to shorten dungeon duration
  let durationMs = diffConfig.durationMs;
  if (potionItemId) {
    const potR = await client.execute({ sql: 'SELECT buff_effect FROM items WHERE id = ?', args: [potionItemId] });
    const rawBuff = potR.rows[0]?.buff_effect;
    if (rawBuff) {
      try {
        const b = JSON.parse(rawBuff);
        if (b.type === 'speed') durationMs = Math.floor(durationMs * b.value);
      } catch { /* ignore */ }
    }
  }

  const now     = Math.floor(Date.now() / 1000);
  const endsAt  = now + Math.floor(durationMs / 1000);
  const newStamina = currentStamina - diffConfig.staminaCost;

  await client.batch([
    {
      sql:  `INSERT INTO dungeon_run
               (character_id, dungeon_level, dungeon_set, kills, monster_id, monster_hp, started_at, difficulty, ends_at, potion_item_id)
             VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      args: [char.id, requestedLevel, requestedSet, monster.id, monster.hp, now, difficulty, endsAt, potionItemId],
    },
    {
      sql:  `UPDATE characters
             SET activity = 'dungeon', activity_started_at = ?, last_tick_at = ?, stamina = ?
             WHERE id = ?`,
      args: [now, now, newStamina, char.id],
    },
  ], 'write');

  res.json(await fullChar(char.id));
});

// GET /api/game/:characterId/dungeon/status
router.get('/:characterId/dungeon/status', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const runR = await client.execute({
    sql:  'SELECT * FROM dungeon_run WHERE character_id = ?',
    args: [char.id],
  });
  const run = runR.rows[0] ? Object.assign({}, runR.rows[0]) : null;
  if (!run) {
    return res.json({ active: false });
  }

  const nowMs       = Date.now();
  const endsAtMs    = Number(run.ends_at) * 1000;
  const remainingMs = Math.max(0, endsAtMs - nowMs);
  const done        = remainingMs === 0;

  if (!done) {
    return res.json({
      active: true,
      remainingMs,
      endsAt: run.ends_at,
      difficulty: run.difficulty,
      dungeon_level: run.dungeon_level,
      dungeon_set: run.dungeon_set,
      potion_item_id: run.potion_item_id ?? null,
    });
  }

  // Timer reached 0 — complete the run and award loot
  const summary = await completeDungeonRun(char, run, false);
  return res.json({
    active: false,
    done: true,
    ...summary,
    char: await fullChar(char.id),
  });
});

// POST /api/game/:characterId/dungeon/stop
router.post('/:characterId/dungeon/stop', async (req, res) => {
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

  // Manual stop: no XP, no loot, no gold — just cancel the run
  const nowSec = Math.floor(Date.now() / 1000);
  await client.batch([
    { sql: 'DELETE FROM dungeon_run WHERE character_id = ?', args: [char.id] },
    {
      sql: `UPDATE characters SET activity = NULL, activity_started_at = NULL, last_tick_at = ? WHERE id = ?`,
      args: [nowSec, char.id],
    },
  ], 'write');

  return res.json({
    done: true,
    forced: true,
    gainedXp: 0,
    gainedGold: 0,
    loot: [],
    char: await fullChar(char.id),
  });
});

module.exports = router;
