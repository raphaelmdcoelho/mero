'use strict';
const express = require('express');
const { client } = require('../db');
const protect = require('../middleware/protect');
const { fullChar } = require('../helpers');

const router = express.Router();
router.use(protect);

// Defense soft-cap: never reaches 100%. At defense=100 → 50% reduction.
function defReduction(defPoints) {
  return defPoints / (defPoints + 100);
}

function calcMaxHp(level, vitality) {
  return 10 + (level - 1) * 5 + vitality * 2;
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

async function heroStats(char) {
  const str = Number(char.attr_strength)   || 5;
  const dex = Number(char.attr_dexterity)  || 5;
  const agi = Number(char.attr_agility)    || 5;
  const res = Number(char.attr_resistance) || 5;

  const [weapR, armR, shieldR] = await Promise.all([
    char.weapon_id ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.weapon_id] }) : Promise.resolve({ rows: [null] }),
    char.armor_id  ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.armor_id] })  : Promise.resolve({ rows: [null] }),
    char.shield_id ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.shield_id] }) : Promise.resolve({ rows: [null] }),
  ]);
  const weapon = weapR.rows[0] ? Object.assign({}, weapR.rows[0]) : null;
  const armor  = armR.rows[0]  ? Object.assign({}, armR.rows[0])  : null;
  const shield = shieldR.rows[0] ? Object.assign({}, shieldR.rows[0]) : null;

  const isRanged  = weapon && weapon.weapon_type === 'ranged';
  const weaponDmg = weapon ? (Number(weapon.damage)  || 0) : 0;
  const armorDef  = armor  ? (Number(armor.defense)  || 0) : 0;
  const shieldDef = shield ? (Number(shield.defense) || 0) : 0;
  const defPoints = Math.floor(res / 3) + armorDef + shieldDef;

  // Ranged gets better accuracy (dex also raises hit vs agile targets)
  const hitChance   = isRanged
    ? Math.min(98, 60 + Math.floor(dex / 2) + Math.floor(dex / 4))
    : Math.min(95, 60 + Math.floor(dex / 2));
  const dodgeChance = Math.min(50, Math.floor(agi / 2));
  const damage      = Math.max(1, 1 + Math.floor((isRanged ? dex : str) / 3) + weaponDmg);

  return { damage, hitChance, dodgeChance, defPoints, damageReduction: defReduction(defPoints), isRanged };
}

// Resolve one full round: hero attacks → monster attacks. Returns turn data.
function resolveTurn(heroName, heroHp, heroStats, monster, monsterHp) {
  const log = [];
  let newMonsterHp = monsterHp;
  let newHeroHp    = heroHp;

  // Hero attacks monster
  const heroHitRoll = Math.floor(Math.random() * 100) + 1;
  if (heroHitRoll > heroStats.hitChance) {
    log.push({ type: 'miss-player', text: `${heroName} attacks but misses!` });
  } else {
    const monsterDodge     = Math.min(50, Math.floor(Number(monster.agility) / 2));
    const monsterDodgeRoll = Math.floor(Math.random() * 100) + 1;
    if (monsterDodgeRoll <= monsterDodge) {
      log.push({ type: 'dodge', text: `${monster.name} dodges the attack!` });
    } else {
      const monDef    = defReduction(Number(monster.defense) || 0);
      const dmg       = Math.max(1, Math.round(heroStats.damage * (1 - monDef)));
      newMonsterHp    = Math.max(0, newMonsterHp - dmg);
      log.push({ type: 'hit-player', text: `${heroName} hits ${monster.name} for ${dmg} damage. (${newMonsterHp}/${monster.hp} HP)` });
    }
  }

  if (newMonsterHp <= 0) {
    return { log, status: 'victory', newMonsterHp: 0, newHeroHp };
  }

  // Monster attacks hero
  const monHitRoll = Math.floor(Math.random() * 100) + 1;
  if (monHitRoll > Number(monster.hit_chance)) {
    log.push({ type: 'miss-monster', text: `${monster.name} attacks but misses!` });
  } else {
    const heroDodgeRoll = Math.floor(Math.random() * 100) + 1;
    if (heroDodgeRoll <= heroStats.dodgeChance) {
      log.push({ type: 'dodge', text: `${heroName} dodges the attack!` });
    } else {
      const dmg    = Math.max(1, Math.round(Number(monster.attack) * (1 - heroStats.damageReduction)));
      newHeroHp    = Math.max(0, newHeroHp - dmg);
      log.push({ type: 'hit-monster', text: `${monster.name} hits ${heroName} for ${dmg} damage. (${Math.ceil(newHeroHp)} HP remaining)` });
    }
  }

  return {
    log,
    status:      newHeroHp <= 0 ? 'defeat' : 'active',
    newMonsterHp: Math.ceil(newMonsterHp),
    newHeroHp:   Math.max(0, newHeroHp),
  };
}

// GET /api/solo/:characterId/monsters
router.get('/:characterId/monsters', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const r = await client.execute('SELECT * FROM solo_monsters ORDER BY id ASC');
  res.json({
    monsters:     r.rows.map(m => ({ ...Object.assign({}, m), loot_table: JSON.parse(m.loot_table || '[]') })),
    heroHp:       Math.ceil(Number(char.hp) || 0),
    heroMaxHp:    Number(char.max_hp) || 20,
    heroStamina:  Number(char.stamina) || 0,
  });
});

// POST /api/solo/:characterId/start  — deduct stamina, open battle session
router.post('/:characterId/start', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const { monster_id } = req.body;
  if (!monster_id) return res.status(400).json({ error: 'monster_id required' });

  if (char.activity && char.activity !== 'dungeon_solo') {
    return res.status(409).json({ error: 'Hero is busy' });
  }

  // Prevent double-start
  const existR = await client.execute({ sql: 'SELECT id FROM solo_battle WHERE character_id = ?', args: [char.id] });
  if (existR.rows[0]) return res.status(409).json({ error: 'Battle already in progress' });

  const monR = await client.execute({ sql: 'SELECT * FROM solo_monsters WHERE id = ?', args: [monster_id] });
  const monster = monR.rows[0] ? Object.assign({}, monR.rows[0]) : null;
  if (!monster) return res.status(404).json({ error: 'Monster not found' });

  const stamina = Number(char.stamina) || 0;
  const cost    = Number(monster.stamina_cost) || 10;
  if (stamina < cost) return res.status(400).json({ error: 'Not enough stamina' });

  const heroHp = Number(char.hp) || 0;
  if (heroHp <= 0) return res.status(400).json({ error: 'Hero has no HP left' });

  await client.execute({
    sql:  "UPDATE characters SET stamina = stamina - ?, activity = 'dungeon_solo' WHERE id = ?",
    args: [cost, char.id],
  });
  await client.execute({
    sql:  'INSERT INTO solo_battle (character_id, monster_id, monster_hp) VALUES (?, ?, ?)',
    args: [char.id, monster.id, monster.hp],
  });

  res.json({
    monster:      { ...monster, loot_table: JSON.parse(monster.loot_table || '[]') },
    heroHp:       Math.ceil(heroHp),
    heroMaxHp:    Number(char.max_hp) || 20,
    monsterHp:    Number(monster.hp),
    monsterMaxHp: Number(monster.hp),
  });
});

// POST /api/solo/:characterId/turn  — resolve one round of combat
router.post('/:characterId/turn', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  const battleR = await client.execute({ sql: 'SELECT * FROM solo_battle WHERE character_id = ?', args: [char.id] });
  const battle  = battleR.rows[0] ? Object.assign({}, battleR.rows[0]) : null;
  if (!battle)                    return res.status(404).json({ error: 'No active battle' });
  if (battle.status !== 'active') return res.status(400).json({ error: 'Battle already ended' });

  const monR    = await client.execute({ sql: 'SELECT * FROM solo_monsters WHERE id = ?', args: [battle.monster_id] });
  const monster = monR.rows[0] ? Object.assign({}, monR.rows[0]) : null;
  if (!monster) return res.status(500).json({ error: 'Monster data missing' });

  const stats      = await heroStats(char);
  const heroHp     = Number(char.hp) || 1;
  const monsterHp  = Number(battle.monster_hp) || 0;
  const turns      = Number(battle.turns) + 1;
  const turn       = resolveTurn(char.name, heroHp, stats, monster, monsterHp);

  if (turn.status === 'victory') {
    const lootTable   = JSON.parse(monster.loot_table || '[]');
    const droppedIds  = lootTable.filter(e => Math.random() * 100 < e.chance).map(e => e.item_id);

    for (const itemId of droppedIds) {
      const ex = await client.execute({ sql: 'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?', args: [char.id, itemId] });
      if (ex.rows[0]) {
        await client.execute({ sql: 'UPDATE inventory SET quantity = quantity + 1 WHERE id = ?', args: [ex.rows[0].id] });
      } else {
        await client.execute({ sql: 'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)', args: [char.id, itemId] });
      }
    }

    let { xp, xp_to_next, level, unspent_points } = char;
    xp             = Number(xp) + Number(monster.xp_reward);
    unspent_points = Number(unspent_points) || 0;
    let leveled    = false;
    while (xp >= xp_to_next) {
      xp        -= xp_to_next;
      level     += 1;
      xp_to_next = Math.floor(10 * Math.pow(1.5, level - 1));
      unspent_points += 5;
      leveled    = true;
    }
    const newMaxHp      = calcMaxHp(level, Number(char.attr_vitality) || 5);
    const newMaxStamina = 5 + (Number(char.attr_stamina) || 5) + Math.floor((level - 1) / 5);

    await client.execute({
      sql: `UPDATE characters
            SET xp = ?, xp_to_next = ?, level = ?, unspent_points = ?,
                max_hp = ?, hp = ?,
                max_stamina = CASE WHEN ? THEN ? ELSE max_stamina END,
                stamina     = CASE WHEN ? THEN ? ELSE stamina END,
                activity    = NULL
            WHERE id = ?`,
      args: [
        xp, xp_to_next, level, unspent_points,
        newMaxHp, Math.min(turn.newHeroHp, newMaxHp),
        leveled ? 1 : 0, newMaxStamina,
        leveled ? 1 : 0, newMaxStamina,
        char.id,
      ],
    });
    await client.execute({ sql: 'DELETE FROM solo_battle WHERE character_id = ?', args: [char.id] });

    let lootDetails = [];
    if (droppedIds.length > 0) {
      const lootR = await client.execute({
        sql:  `SELECT id, name, icon FROM items WHERE id IN (${droppedIds.map(() => '?').join(',')})`,
        args: droppedIds,
      });
      lootDetails = lootR.rows.map(r => Object.assign({}, r));
    }

    return res.json({
      turn: turns, log: turn.log, status: 'victory',
      heroHp: Math.max(1, Math.ceil(turn.newHeroHp)), monsterHp: 0,
      xpGained: Number(monster.xp_reward), loot: lootDetails, leveled,
      char: await fullChar(char.id),
    });
  }

  if (turn.status === 'defeat') {
    await client.execute({ sql: 'UPDATE characters SET hp = 1, activity = NULL WHERE id = ?', args: [char.id] });
    await client.execute({ sql: 'DELETE FROM solo_battle WHERE character_id = ?', args: [char.id] });

    return res.json({
      turn: turns, log: turn.log, status: 'defeat',
      heroHp: 1, monsterHp: turn.newMonsterHp,
      char: await fullChar(char.id),
    });
  }

  await client.execute({ sql: 'UPDATE solo_battle SET monster_hp = ?, turns = ? WHERE character_id = ?', args: [turn.newMonsterHp, turns, char.id] });
  await client.execute({ sql: 'UPDATE characters SET hp = ? WHERE id = ?', args: [turn.newHeroHp, char.id] });

  res.json({
    turn: turns, log: turn.log, status: 'active',
    heroHp: Math.max(0, Math.ceil(turn.newHeroHp)),
    monsterHp: turn.newMonsterHp,
  });
});

// POST /api/solo/:characterId/flee  — abandon battle, no reward, stamina not refunded
router.post('/:characterId/flee', async (req, res) => {
  const char = await ownedChar(req, res);
  if (!char) return;

  await client.execute({ sql: 'DELETE FROM solo_battle WHERE character_id = ?', args: [char.id] });
  await client.execute({ sql: "UPDATE characters SET activity = NULL WHERE id = ?", args: [char.id] });

  res.json({ fled: true, char: await fullChar(char.id) });
});

module.exports = router;
