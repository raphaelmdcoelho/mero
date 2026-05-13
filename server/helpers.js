'use strict';
const { client } = require('./db');

// Shared full character state — used by game.js and market.js
// Uses two parallel Promise.all batches to minimize round trips (2 total instead of 7+)
async function fullChar(charId) {
  const [charR, invR, farmR, runR] = await Promise.all([
    client.execute({ sql: 'SELECT * FROM characters WHERE id = ?', args: [charId] }),
    client.execute({
      sql: `SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon,
                   i.damage, i.defense, i.weapon_type, i.armor_slot, i.sell_price, i.buy_price,
                   i.item_subtype, i.buff_effect
            FROM inventory inv JOIN items i ON i.id = inv.item_id
            WHERE inv.character_id = ?`,
      args: [charId],
    }),
    client.execute({
      sql:  'SELECT id, plant_type, ready_at, remaining_seconds FROM farm_queue WHERE character_id = ? ORDER BY id ASC',
      args: [charId],
    }),
    client.execute({ sql: 'SELECT * FROM dungeon_run WHERE character_id = ?', args: [charId] }),
  ]);

  const char      = Object.assign({}, charR.rows[0]);
  const inventory = invR.rows.map(r => Object.assign({}, r));
  const farmQueue = farmR.rows.map(r => Object.assign({}, r));
  const runRow    = runR.rows[0] ?? null;

  const [weapR, armR, shieldR, armGlovesR, bootsR, helmetR, monR] = await Promise.all([
    char.weapon_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.weapon_id] })
      : Promise.resolve({ rows: [null] }),
    char.armor_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.armor_id] })
      : Promise.resolve({ rows: [null] }),
    char.shield_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.shield_id] })
      : Promise.resolve({ rows: [null] }),
    char.arm_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.arm_id] })
      : Promise.resolve({ rows: [null] }),
    char.boots_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.boots_id] })
      : Promise.resolve({ rows: [null] }),
    char.helmet_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.helmet_id] })
      : Promise.resolve({ rows: [null] }),
    runRow?.monster_id
      ? client.execute({ sql: 'SELECT * FROM monsters WHERE id = ?', args: [runRow.monster_id] })
      : Promise.resolve({ rows: [null] }),
  ]);

  const equippedWeapon = weapR.rows[0]      ? Object.assign({}, weapR.rows[0])      : null;
  const equippedArmor  = armR.rows[0]       ? Object.assign({}, armR.rows[0])       : null;
  const equippedShield = shieldR.rows[0]    ? Object.assign({}, shieldR.rows[0])    : null;
  const equippedArm    = armGlovesR.rows[0] ? Object.assign({}, armGlovesR.rows[0]) : null;
  const equippedBoots  = bootsR.rows[0]     ? Object.assign({}, bootsR.rows[0])     : null;
  const equippedHelmet = helmetR.rows[0]    ? Object.assign({}, helmetR.rows[0])    : null;

  let dungeonRun = null;
  if (runRow) {
    dungeonRun = Object.assign({}, runRow);
    dungeonRun.monster = monR.rows[0] ? Object.assign({}, monR.rows[0]) : null;
  }

  const farmLevel   = Number(char.farm_level) || 1;
  const farmXp      = Number(char.farm_xp)    || 0;
  const farmXpToNext = farmLevel * 5;

  return { ...char, inventory, equippedWeapon, equippedArmor, equippedShield, equippedArm, equippedBoots, equippedHelmet, farmQueue, dungeonRun, farmLevel, farmXp, farmXpToNext };
}

module.exports = { fullChar };
