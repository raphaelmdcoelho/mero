'use strict';
const { createClient } = require('@libsql/client');

const client = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function transaction(fn) {
  const tx = await client.transaction('write');
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function initDb() {
  await client.execute('PRAGMA foreign_keys = ON');

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    UNIQUE NOT NULL,
      password   TEXT    NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('weapon','armor','consumable','misc')),
      description TEXT,
      icon        TEXT
    );

    CREATE TABLE IF NOT EXISTS characters (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id),
      name                TEXT    NOT NULL,
      class               TEXT    NOT NULL CHECK(class IN ('Warrior','Mage','Rogue','Cleric')),
      level               INTEGER NOT NULL DEFAULT 1,
      xp                  INTEGER NOT NULL DEFAULT 0,
      xp_to_next          INTEGER NOT NULL DEFAULT 10,
      hp                  REAL    NOT NULL DEFAULT 20,
      max_hp              INTEGER NOT NULL DEFAULT 20,
      avatar_path         TEXT,
      weapon_id           INTEGER REFERENCES items(id),
      armor_id            INTEGER REFERENCES items(id),
      activity            TEXT    DEFAULT NULL,
      activity_started_at INTEGER DEFAULT NULL,
      dungeon_difficulty  TEXT    DEFAULT NULL,
      last_tick_at        INTEGER DEFAULT NULL,
      created_at          INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id),
      item_id      INTEGER NOT NULL REFERENCES items(id),
      quantity     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS plants_inventory (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id),
      plant_type   TEXT NOT NULL CHECK(plant_type IN ('carrot', 'apple')),
      quantity     INTEGER NOT NULL DEFAULT 0,
      UNIQUE(character_id, plant_type)
    );

    CREATE TABLE IF NOT EXISTS farm_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id),
      plant_type   TEXT NOT NULL CHECK(plant_type IN ('carrot', 'apple')),
      ready_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monsters (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dungeon_level INTEGER NOT NULL,
      name          TEXT NOT NULL,
      icon          TEXT NOT NULL,
      hp            INTEGER NOT NULL,
      damage        INTEGER NOT NULL,
      hit_chance    INTEGER NOT NULL,
      dodge_chance  INTEGER NOT NULL,
      defense       INTEGER NOT NULL,
      xp_reward     INTEGER NOT NULL,
      is_boss       INTEGER NOT NULL DEFAULT 0,
      drop_item_id  INTEGER REFERENCES items(id),
      drop_chance   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dungeon_run (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id  INTEGER NOT NULL REFERENCES characters(id) UNIQUE,
      dungeon_level INTEGER NOT NULL,
      kills         INTEGER NOT NULL DEFAULT 0,
      monster_id    INTEGER NOT NULL REFERENCES monsters(id),
      monster_hp    REAL    NOT NULL,
      started_at    INTEGER NOT NULL
    );
  `);

  // Additive migrations — safe to run on existing DBs
  const additiveMigrations = [
    'ALTER TABLE characters ADD COLUMN attr_strength     INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_dexterity    INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_agility      INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_vitality     INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_intelligence INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_focus        INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_stamina      INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN attr_resistance   INTEGER DEFAULT 5',
    'ALTER TABLE characters ADD COLUMN unspent_points    INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN dungeon_mastery          INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN reading_points_awarded   INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN gold              INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN dungeon_mastery_s2 INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN dungeon_mastery_s3 INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN dungeon_mastery_s4 INTEGER DEFAULT 0',
    'ALTER TABLE characters ADD COLUMN dungeon_mastery_s5 INTEGER DEFAULT 0',
    'ALTER TABLE items ADD COLUMN damage      INTEGER DEFAULT 0',
    'ALTER TABLE items ADD COLUMN defense     INTEGER DEFAULT 0',
    'ALTER TABLE items ADD COLUMN weapon_type TEXT    DEFAULT NULL',
    'ALTER TABLE items ADD COLUMN sell_price  INTEGER DEFAULT 0',
    'ALTER TABLE monsters ADD COLUMN dungeon_set INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE dungeon_run ADD COLUMN dungeon_set INTEGER NOT NULL DEFAULT 1',
  ];

  for (const sql of additiveMigrations) {
    try { await client.execute(sql); } catch { /* column already exists — skip */ }
  }

  // Recalculate max_hp for all characters to include vitality bonus:
  // max_hp = 10 + (level-1)*5 + vitality*2
  await client.execute(`
    UPDATE characters
    SET max_hp = 10 + (level - 1) * 5 + COALESCE(attr_vitality, 5) * 2,
        hp     = MIN(hp, 10 + (level - 1) * 5 + COALESCE(attr_vitality, 5) * 2)
    WHERE 1=1
  `);

  // Seed / update items with damage, defense, weapon_type
  // id, name, type, description, icon, damage, defense, weapon_type, sell_price
  const itemData = [
    [1,  'Wooden Sword',  'weapon',     'A basic training sword.',        '🗡️',  2, 0, 'melee',   5],
    [2,  'Iron Sword',    'weapon',     'A sturdy iron blade.',           '⚔️',  4, 0, 'melee',  15],
    [3,  'Leather Armor', 'armor',      'Light but protective.',          '🥋',  0, 2,  null,    10],
    [4,  'Iron Shield',   'armor',      'Heavy iron shield.',             '🛡️',  0, 3,  null,    20],
    [5,  'Health Potion', 'consumable', 'Restores 5 HP.',                 '🧪',  0, 0,  null,     8],
    [6,  'Carrot',        'consumable', 'Restores 2 HP.',                 '🥕',  0, 0,  null,     3],
    [7,  'Apple',         'consumable', 'Restores 1 HP.',                 '🍎',  0, 0,  null,     2],
    [8,  'Short Bow',     'weapon',     'A ranged weapon. Uses Dexterity.','🏹', 3, 0, 'ranged', 18],
    [9,  'Steel Sword',   'weapon',     'A finely forged steel blade.',   '🔪',  6, 0, 'melee',  35],
    [10, 'Chainmail',     'armor',      'Linked metal rings for armor.',  '🔗',  0, 4,  null,    30],
    [11, 'Plate Armor',   'armor',      'Heavy full-body plate armor.',   '🛡️',  0, 6,  null,    50],
  ];

  await client.batch([
    ...itemData.map(([id, name, type, desc, icon]) => ({
      sql:  'INSERT OR IGNORE INTO items (id, name, type, description, icon) VALUES (?, ?, ?, ?, ?)',
      args: [id, name, type, desc, icon],
    })),
    ...itemData.map(([id, , , , , dmg, def, wt, sp]) => ({
      sql:  'UPDATE items SET damage = ?, defense = ?, weapon_type = ?, sell_price = ? WHERE id = ?',
      args: [dmg, def, wt, sp, id],
    })),
  ], 'write');

  // ── Seed monsters ───────────────────────────────────────────────────────────
  // format per row: [dungeon_level, name, icon, hp, dmg, hit%, dodge%, def, xp, is_boss, drop_item_id, drop%]
  const monsterSql = `
    INSERT INTO monsters
      (dungeon_set, dungeon_level, name, icon, hp, damage, hit_chance, dodge_chance, defense, xp_reward, is_boss, drop_item_id, drop_chance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  // Set 1 — Verdant Wilds (available from level 1)
  {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM monsters WHERE dungeon_set = 1");
    if (Number(r.rows[0].cnt) === 0) {
      await client.batch([
        { sql: monsterSql, args: [1,  1,'Goblin',           '👺',   12,   3, 55,  8,  0,    5,  0,  1,  8] },
        { sql: monsterSql, args: [1,  1,'Goblin King',      '👹',   60,   5, 60,  5,  1,   55,  1,  3, 40] },
        { sql: monsterSql, args: [1,  2,'Orc Grunt',        '🧌',   18,   4, 58,  5,  1,    8,  0,  3,  8] },
        { sql: monsterSql, args: [1,  2,'Orc Chieftain',    '💪',  100,   8, 62,  4,  2,   90,  1,  4, 38] },
        { sql: monsterSql, args: [1,  3,'Skeleton',         '💀',   22,   5, 60,  6,  2,   12,  0,  2,  8] },
        { sql: monsterSql, args: [1,  3,'Skeleton Warlord', '⚔️',  150,  10, 65,  6,  3,  130,  1,  2, 35] },
        { sql: monsterSql, args: [1,  4,'Dark Elf',         '🧝',   28,   7, 65, 12,  2,   18,  0,  8,  8] },
        { sql: monsterSql, args: [1,  4,'Dark Elf Assassin','🗡️',  200,  13, 68, 15,  4,  180,  1,  8, 35] },
        { sql: monsterSql, args: [1,  5,'Werewolf',         '🐺',   38,   9, 67, 14,  3,   26,  0,  4,  8] },
        { sql: monsterSql, args: [1,  5,'Alpha Werewolf',   '🌕',  280,  17, 70, 12,  5,  250,  1,  9, 30] },
        { sql: monsterSql, args: [1,  6,'Vampire',          '🧛',   50,  12, 68, 16,  4,   38,  0,  9,  8] },
        { sql: monsterSql, args: [1,  6,'Vampire Lord',     '🩸',  380,  22, 72, 14,  6,  360,  1, 10, 30] },
        { sql: monsterSql, args: [1,  7,'Stone Golem',      '🪨',   65,  15, 65,  6,  6,   55,  0, 10,  8] },
        { sql: monsterSql, args: [1,  7,'Stone Titan',      '⛰️',  500,  28, 68,  5,  8,  480,  1, 10, 30] },
        { sql: monsterSql, args: [1,  8,'Demon',            '😈',   80,  18, 70, 12,  7,   75,  0, 11,  8] },
        { sql: monsterSql, args: [1,  8,'Arch Demon',       '👿',  640,  34, 73, 10,  9,  640,  1, 11, 25] },
        { sql: monsterSql, args: [1,  9,'Shadow Beast',     '🌑',  100,  23, 72, 16,  8,  100,  0, 11,  8] },
        { sql: monsterSql, args: [1,  9,'Shadow King',      '👁️',  800,  42, 75, 14, 11,  820,  1, 11, 25] },
        { sql: monsterSql, args: [1, 10,'Dragon Spawn',     '🐉',  130,  30, 75, 18, 10,  135,  0, 11, 10] },
        { sql: monsterSql, args: [1, 10,'Ancient Dragon',   '🐲', 1000,  52, 78, 16, 13, 1000,  1, 11, 40] },
      ], 'write');
    }
  }

  // Set 2 — Volcanic Depths (unlocks at level 20, ~4x Set 1 stats)
  {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM monsters WHERE dungeon_set = 2");
    if (Number(r.rows[0].cnt) === 0) {
      await client.batch([
        { sql: monsterSql, args: [2,  1,'Fire Sprite',      '🔥',    48,   9, 58, 10,  1,   20,  0,  2,  8] },
        { sql: monsterSql, args: [2,  2,'Ember Grunt',      '🧌',    72,  12, 61,  7,  2,   32,  0,  3,  8] },
        { sql: monsterSql, args: [2,  3,'Lava Skeleton',    '💀',    88,  15, 63,  8,  3,   48,  0,  2,  8] },
        { sql: monsterSql, args: [2,  4,'Magma Elf',        '🧝',   112,  21, 68, 14,  4,   72,  0,  8,  8] },
        { sql: monsterSql, args: [2,  5,'Flame Wolf',       '🐺',   152,  27, 70, 16,  5,  104,  0,  4,  8] },
        { sql: monsterSql, args: [2,  6,'Lava Bat',         '🦇',   200,  36, 71, 18,  7,  152,  0,  9,  8] },
        { sql: monsterSql, args: [2,  7,'Molten Golem',     '🪨',   260,  45, 68,  8, 10,  220,  0, 10,  8] },
        { sql: monsterSql, args: [2,  8,'Fire Demon',       '😈',   320,  54, 73, 14, 12,  300,  0, 11,  8] },
        { sql: monsterSql, args: [2,  9,'Inferno Beast',    '🌋',   400,  69, 75, 18, 14,  400,  0, 11,  8] },
        { sql: monsterSql, args: [2, 10,'Dragon Ember',     '🐉',   520,  90, 78, 20, 18,  540,  0, 11, 10] },
        { sql: monsterSql, args: [2,  1,'Lava Titan',       '🌋',   240,  15, 63,  7,  3,  220,  1,  3, 40] },
        { sql: monsterSql, args: [2,  2,'Magma Warchief',   '💪',   400,  24, 65,  6,  5,  360,  1,  4, 38] },
        { sql: monsterSql, args: [2,  3,'Inferno Warlord',  '⚔️',   600,  30, 68,  8,  6,  520,  1,  2, 35] },
        { sql: monsterSql, args: [2,  4,'Magma Assassin',   '🗡️',   800,  39, 71, 17,  8,  720,  1,  8, 35] },
        { sql: monsterSql, args: [2,  5,'Alpha Flame Wolf', '🌕',  1120,  51, 73, 14, 10, 1000,  1,  9, 30] },
        { sql: monsterSql, args: [2,  6,'Hellfire Lord',    '🔥',  1520,  66, 75, 16, 12, 1440,  1, 10, 30] },
        { sql: monsterSql, args: [2,  7,'Volcano Titan',    '⛰️',  2000,  84, 71,  7, 16, 1920,  1, 10, 30] },
        { sql: monsterSql, args: [2,  8,'Arch Fire Demon',  '👿',  2560, 102, 76, 12, 18, 2560,  1, 11, 25] },
        { sql: monsterSql, args: [2,  9,'Inferno Tyrant',   '👁️',  3200, 126, 78, 16, 22, 3280,  1, 11, 25] },
        { sql: monsterSql, args: [2, 10,'Elder Drake',      '🔥',  4000, 156, 81, 18, 26, 4000,  1, 11, 40] },
      ], 'write');
    }
  }

  // Set 3 — Frozen Wastes (unlocks at level 30, ~10x Set 1 stats)
  {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM monsters WHERE dungeon_set = 3");
    if (Number(r.rows[0].cnt) === 0) {
      await client.batch([
        { sql: monsterSql, args: [3,  1,'Frost Wisp',         '❄️',    120,   21, 60, 12,  2,   50,  0,  2,  8] },
        { sql: monsterSql, args: [3,  2,'Ice Troll',          '🧌',    180,   28, 63,  9,  4,   80,  0,  3,  8] },
        { sql: monsterSql, args: [3,  3,'Frost Revenant',     '💀',    220,   35, 65, 10,  6,  120,  0,  2,  8] },
        { sql: monsterSql, args: [3,  4,'Snow Elf',           '🧝',    280,   49, 70, 16,  8,  180,  0,  8,  8] },
        { sql: monsterSql, args: [3,  5,'Ice Wolf',           '🐺',    380,   63, 72, 18, 10,  260,  0,  4,  8] },
        { sql: monsterSql, args: [3,  6,'Frost Vampire',      '🧛',    500,   84, 73, 20, 14,  380,  0,  9,  8] },
        { sql: monsterSql, args: [3,  7,'Crystal Golem',      '💎',    650,  105, 70, 10, 18,  550,  0, 10,  8] },
        { sql: monsterSql, args: [3,  8,'Frost Demon',        '😈',    800,  126, 75, 16, 21,  750,  0, 11,  8] },
        { sql: monsterSql, args: [3,  9,'Blizzard Beast',     '🌨️',  1000,  161, 77, 20, 24, 1000,  0, 11,  8] },
        { sql: monsterSql, args: [3, 10,'Frost Drake',        '🐉',   1300,  210, 80, 22, 30, 1350,  0, 11, 10] },
        { sql: monsterSql, args: [3,  1,'Glacier Titan',      '🧊',    600,   36, 63,  9,  5,  550,  1,  3, 40] },
        { sql: monsterSql, args: [3,  2,'Permafrost Warlord', '💪',   1000,   56, 66,  8,  9,  880,  1,  4, 38] },
        { sql: monsterSql, args: [3,  3,'Frost Bone King',    '⚔️',   1500,   70, 68, 10, 12, 1300,  1,  2, 35] },
        { sql: monsterSql, args: [3,  4,'Ice Assassin',       '🗡️',   2000,   98, 73, 19, 16, 1980,  1,  8, 35] },
        { sql: monsterSql, args: [3,  5,'Arctic Alpha',       '🌕',   2800,  126, 75, 16, 20, 2860,  1,  9, 30] },
        { sql: monsterSql, args: [3,  6,'Blizzard Lord',      '❄️',   3800,  168, 76, 18, 26, 4180,  1, 10, 30] },
        { sql: monsterSql, args: [3,  7,'Crystal Titan',      '⛰️',   5000,  210, 73,  9, 32, 6050,  1, 10, 30] },
        { sql: monsterSql, args: [3,  8,'Arch Frost Demon',   '👿',   6400,  252, 78, 14, 38, 8250,  1, 11, 25] },
        { sql: monsterSql, args: [3,  9,'Blizzard King',      '👁️',   8000,  322, 80, 18, 44,10000,  1, 11, 25] },
        { sql: monsterSql, args: [3, 10,'Ancient Ice Dragon', '🧊',  10000,  420, 83, 20, 54,13500,  1, 11, 40] },
      ], 'write');
    }
  }

  // Set 4 — Thunder Peaks (unlocks at level 40, ~25x Set 1 stats)
  {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM monsters WHERE dungeon_set = 4");
    if (Number(r.rows[0].cnt) === 0) {
      await client.batch([
        { sql: monsterSql, args: [4,  1,'Storm Sprite',        '⚡',    300,   54, 61, 13,  4,   125,  0,  2,  8] },
        { sql: monsterSql, args: [4,  2,'Thunder Orc',         '🧌',    450,   72, 64, 10,  7,   200,  0,  3,  8] },
        { sql: monsterSql, args: [4,  3,'Lightning Bone',      '💀',    550,   90, 66, 11, 10,   300,  0,  2,  8] },
        { sql: monsterSql, args: [4,  4,'Storm Elf',           '🧝',    700,  126, 71, 17, 12,   450,  0,  8,  8] },
        { sql: monsterSql, args: [4,  5,'Thunder Wolf',        '🐺',    950,  162, 73, 19, 14,   650,  0,  4,  8] },
        { sql: monsterSql, args: [4,  6,'Spark Vampire',       '🧛',   1250,  216, 74, 21, 18,   950,  0,  9,  8] },
        { sql: monsterSql, args: [4,  7,'Thunder Golem',       '🪨',   1625,  270, 71, 11, 24,  1375,  0, 10,  8] },
        { sql: monsterSql, args: [4,  8,'Storm Demon',         '😈',   2000,  324, 76, 17, 27,  1875,  0, 11,  8] },
        { sql: monsterSql, args: [4,  9,'Lightning Beast',     '⚡',   2500,  414, 78, 21, 30,  2500,  0, 11,  8] },
        { sql: monsterSql, args: [4, 10,'Storm Drake',         '🐉',   3250,  540, 81, 23, 36,  3375,  0, 11, 10] },
        { sql: monsterSql, args: [4,  1,'Thunder Titan',       '⚡',   1500,  108, 64, 10,  9,  1375,  1,  3, 40] },
        { sql: monsterSql, args: [4,  2,'Storm Warchief',      '💪',   2500,  144, 67,  9, 16,  2200,  1,  4, 38] },
        { sql: monsterSql, args: [4,  3,'Lightning Warlord',   '⚔️',   3750,  180, 69, 11, 22,  3300,  1,  2, 35] },
        { sql: monsterSql, args: [4,  4,'Storm Assassin',      '🗡️',   5000,  252, 74, 20, 28,  4950,  1,  8, 35] },
        { sql: monsterSql, args: [4,  5,'Alpha Thunder Wolf',  '🌕',   7000,  324, 76, 17, 34,  7150,  1,  9, 30] },
        { sql: monsterSql, args: [4,  6,'Thunder Lord',        '⚡',   9500,  432, 77, 19, 42, 10450,  1, 10, 30] },
        { sql: monsterSql, args: [4,  7,'Lightning Titan',     '⛰️',  12500,  540, 74, 10, 52, 15125,  1, 10, 30] },
        { sql: monsterSql, args: [4,  8,'Arch Storm Demon',    '👿',  16000,  648, 79, 15, 58, 20625,  1, 11, 25] },
        { sql: monsterSql, args: [4,  9,'Lightning Emperor',   '👁️',  20000,  828, 81, 19, 64, 27500,  1, 11, 25] },
        { sql: monsterSql, args: [4, 10,'Ancient Storm Dragon','🌩', 25000, 1080, 84, 21, 78, 33750,  1, 11, 40] },
      ], 'write');
    }
  }

  // Set 5 — Void Realm (unlocks at level 50, ~70x Set 1 stats)
  {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM monsters WHERE dungeon_set = 5");
    if (Number(r.rows[0].cnt) === 0) {
      await client.batch([
        { sql: monsterSql, args: [5,  1,'Void Wisp',          '🌑',    840,   135, 63, 15,  6,    350,  0,  2,  8] },
        { sql: monsterSql, args: [5,  2,'Void Brute',         '🧌',   1260,   180, 66, 12, 12,    560,  0,  3,  8] },
        { sql: monsterSql, args: [5,  3,'Void Revenant',      '💀',   1540,   225, 68, 13, 18,    840,  0,  2,  8] },
        { sql: monsterSql, args: [5,  4,'Void Stalker',       '🧝',   1960,   315, 73, 19, 20,   1260,  0,  8,  8] },
        { sql: monsterSql, args: [5,  5,'Void Hound',         '🐺',   2660,   405, 75, 21, 24,   1820,  0,  4,  8] },
        { sql: monsterSql, args: [5,  6,'Void Wraith',        '👻',   3500,   540, 76, 23, 30,   2660,  0,  9,  8] },
        { sql: monsterSql, args: [5,  7,'Void Construct',     '🤖',   4550,   675, 73, 13, 36,   3850,  0, 10,  8] },
        { sql: monsterSql, args: [5,  8,'Void Fiend',         '😈',   5600,   810, 78, 19, 42,   5250,  0, 11,  8] },
        { sql: monsterSql, args: [5,  9,'Void Reaper',        '💀',   7000,  1035, 80, 23, 48,   7000,  0, 11,  8] },
        { sql: monsterSql, args: [5, 10,'Void Drake',         '🐉',   9100,  1350, 83, 25, 60,   9450,  0, 11, 10] },
        { sql: monsterSql, args: [5,  1,'Void Titan',         '🌑',   4200,   270, 66, 12, 14,   3850,  1,  3, 40] },
        { sql: monsterSql, args: [5,  2,'Void Warchief',      '💪',   7000,   360, 69, 11, 28,   6160,  1,  4, 38] },
        { sql: monsterSql, args: [5,  3,'Void Warlord',       '⚔️',  10500,   450, 71, 12, 42,   9240,  1,  2, 35] },
        { sql: monsterSql, args: [5,  4,'Void Assassin',      '🗡️',  13720,   630, 76, 22, 54,  13860,  1,  8, 35] },
        { sql: monsterSql, args: [5,  5,'Void Prime',         '🌕',  18620,   810, 78, 19, 66,  20020,  1,  9, 30] },
        { sql: monsterSql, args: [5,  6,'Void Lord',          '🌑',  24500,  1080, 79, 21, 80,  29260,  1, 10, 30] },
        { sql: monsterSql, args: [5,  7,'Void Colossus',      '⛰️',  31850,  1350, 76, 12,100,  42350,  1, 10, 30] },
        { sql: monsterSql, args: [5,  8,'Arch Void Demon',    '👿',  39200,  1620, 81, 17,114,  57750,  1, 11, 25] },
        { sql: monsterSql, args: [5,  9,'Void Emperor',       '👁️',  49000,  2070, 83, 21,130,  77000,  1, 11, 25] },
        { sql: monsterSql, args: [5, 10,'Void Leviathan',     '🌑',  63700,  2700, 86, 23,162,  94500,  1, 11, 40] },
      ], 'write');
    }
  }
}

module.exports = { client, transaction, initDb };
