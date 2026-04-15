'use strict';
const { client } = require('./db');

// Shared full character state — used by game.js and market.js
// Uses two parallel Promise.all batches to minimize round trips (2 total instead of 7+)
async function fullChar(charId) {
  const [charR, invR, farmR, runR] = await Promise.all([
    client.execute({ sql: 'SELECT * FROM characters WHERE id = ?', args: [charId] }),
    client.execute({
      sql: `SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon,
                   i.damage, i.defense, i.weapon_type, i.sell_price
            FROM inventory inv JOIN items i ON i.id = inv.item_id
            WHERE inv.character_id = ?`,
      args: [charId],
    }),
    client.execute({
      sql:  'SELECT id, plant_type, ready_at FROM farm_queue WHERE character_id = ? ORDER BY ready_at ASC',
      args: [charId],
    }),
    client.execute({ sql: 'SELECT * FROM dungeon_run WHERE character_id = ?', args: [charId] }),
  ]);

  const char      = Object.assign({}, charR.rows[0]);
  const inventory = invR.rows.map(r => Object.assign({}, r));
  const farmQueue = farmR.rows.map(r => Object.assign({}, r));
  const runRow    = runR.rows[0] ?? null;

  const [weapR, armR, monR] = await Promise.all([
    char.weapon_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.weapon_id] })
      : Promise.resolve({ rows: [null] }),
    char.armor_id
      ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [char.armor_id] })
      : Promise.resolve({ rows: [null] }),
    runRow?.monster_id
      ? client.execute({ sql: 'SELECT * FROM monsters WHERE id = ?', args: [runRow.monster_id] })
      : Promise.resolve({ rows: [null] }),
  ]);

  const equippedWeapon = weapR.rows[0] ? Object.assign({}, weapR.rows[0]) : null;
  const equippedArmor  = armR.rows[0]  ? Object.assign({}, armR.rows[0])  : null;

  let dungeonRun = null;
  if (runRow) {
    dungeonRun = Object.assign({}, runRow);
    dungeonRun.monster = monR.rows[0] ? Object.assign({}, monR.rows[0]) : null;
  }

  return { ...char, inventory, equippedWeapon, equippedArmor, farmQueue, dungeonRun };
}

module.exports = { fullChar };
