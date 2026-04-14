const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'mero.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Helper: run a function inside a transaction
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Run all migrations
db.exec(`
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
`);

// Farming tables
db.exec(`
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
`);

// Monsters and dungeon run tables
db.exec(`
  CREATE TABLE IF NOT EXISTS monsters (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dungeon_level INTEGER NOT NULL,
    name         TEXT NOT NULL,
    icon         TEXT NOT NULL,
    hp           INTEGER NOT NULL,
    damage       INTEGER NOT NULL,
    hit_chance   INTEGER NOT NULL,
    dodge_chance INTEGER NOT NULL,
    defense      INTEGER NOT NULL,
    xp_reward    INTEGER NOT NULL,
    is_boss      INTEGER NOT NULL DEFAULT 0,
    drop_item_id INTEGER REFERENCES items(id),
    drop_chance  INTEGER NOT NULL DEFAULT 0
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
  'ALTER TABLE characters ADD COLUMN dungeon_mastery   INTEGER DEFAULT 0',
  'ALTER TABLE items ADD COLUMN damage      INTEGER DEFAULT 0',
  'ALTER TABLE items ADD COLUMN defense     INTEGER DEFAULT 0',
  'ALTER TABLE items ADD COLUMN weapon_type TEXT    DEFAULT NULL',
];

for (const sql of additiveMigrations) {
  try { db.exec(sql); } catch { /* column already exists — skip */ }
}

// Recalculate max_hp for all characters to include vitality bonus:
// max_hp = 10 + (level-1)*5 + vitality*2
db.exec(`
  UPDATE characters
  SET max_hp = 10 + (level - 1) * 5 + COALESCE(attr_vitality, 5) * 2,
      hp     = MIN(hp, 10 + (level - 1) * 5 + COALESCE(attr_vitality, 5) * 2)
  WHERE 1=1
`);

// Seed / update items with damage, defense, weapon_type
{
  const upsertItem = db.prepare(`
    INSERT OR IGNORE INTO items (id, name, type, description, icon) VALUES (?, ?, ?, ?, ?)
  `);
  const setStats = db.prepare(`
    UPDATE items SET damage = ?, defense = ?, weapon_type = ? WHERE id = ?
  `);

  const itemData = [
    // id, name, type, description, icon, damage, defense, weapon_type
    [1,  'Wooden Sword',  'weapon',     'A basic training sword.',        '🗡️',  2, 0, 'melee'],
    [2,  'Iron Sword',    'weapon',     'A sturdy iron blade.',           '⚔️',  4, 0, 'melee'],
    [3,  'Leather Armor', 'armor',      'Light but protective.',          '🥋',  0, 2, null],
    [4,  'Iron Shield',   'armor',      'Heavy iron shield.',             '🛡️',  0, 3, null],
    [5,  'Health Potion', 'consumable', 'Restores 5 HP.',                 '🧪',  0, 0, null],
    [6,  'Carrot',        'consumable', 'Restores 2 HP.',                 '🥕',  0, 0, null],
    [7,  'Apple',         'consumable', 'Restores 1 HP.',                 '🍎',  0, 0, null],
    [8,  'Short Bow',     'weapon',     'A ranged weapon. Uses Dexterity.','🏹', 3, 0, 'ranged'],
    [9,  'Steel Sword',   'weapon',     'A finely forged steel blade.',   '🔪',  6, 0, 'melee'],
    [10, 'Chainmail',     'armor',      'Linked metal rings for armor.',  '🔗',  0, 4, null],
    [11, 'Plate Armor',   'armor',      'Heavy full-body plate armor.',   '🛡️',  0, 6, null],
  ];

  transaction(() => {
    for (const [id, name, type, desc, icon, dmg, def, wt] of itemData) {
      upsertItem.run(id, name, type, desc, icon);
      setStats.run(dmg, def, wt, id);
    }
  });
}

// Seed farm consumables (safe — INSERT OR IGNORE)
{
  const ins = db.prepare('INSERT OR IGNORE INTO items (id, name, type, description, icon) VALUES (?, ?, ?, ?, ?)');
  ins.run(6, 'Carrot', 'consumable', 'Restores 2 HP.', '🥕');
  ins.run(7, 'Apple',  'consumable', 'Restores 1 HP.', '🍎');
}

// Seed monsters (one regular + one boss per dungeon level 1-10)
{
  const count = db.prepare('SELECT COUNT(*) as cnt FROM monsters').get();
  if (count.cnt === 0) {
    const ins = db.prepare(`
      INSERT INTO monsters
        (dungeon_level, name, icon, hp, damage, hit_chance, dodge_chance, defense, xp_reward, is_boss, drop_item_id, drop_chance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    transaction(() => {
      // level, name, icon, hp, dmg, hit%, dodge%, def, xp, boss, drop_item_id, drop%
      // Lvl 1
      ins.run(1,'Goblin',          '👺', 12, 3,55, 8,0, 5,0,1,  8);
      ins.run(1,'Goblin King',     '👹', 60, 5,60, 5,1,55,1,3, 40);
      // Lvl 2
      ins.run(2,'Orc Grunt',       '🧌', 18, 4,58, 5,1, 8,0,3,  8);
      ins.run(2,'Orc Chieftain',   '💪', 100,8,62, 4,2,90,1,4, 38);
      // Lvl 3
      ins.run(3,'Skeleton',        '💀', 22, 5,60, 6,2,12,0,2,  8);
      ins.run(3,'Skeleton Warlord','⚔️',150,10,65, 6,3,130,1,2,35);
      // Lvl 4
      ins.run(4,'Dark Elf',        '🧝', 28, 7,65,12,2,18,0,8,  8);
      ins.run(4,'Dark Elf Assassin','🗡️',200,13,68,15,4,180,1,8,35);
      // Lvl 5
      ins.run(5,'Werewolf',        '🐺', 38, 9,67,14,3,26,0,4,  8);
      ins.run(5,'Alpha Werewolf',  '🌕',280,17,70,12,5,250,1,9,30);
      // Lvl 6
      ins.run(6,'Vampire',         '🧛', 50,12,68,16,4,38,0,9,  8);
      ins.run(6,'Vampire Lord',    '🩸',380,22,72,14,6,360,1,10,30);
      // Lvl 7
      ins.run(7,'Stone Golem',     '🪨', 65,15,65, 6,6,55,0,10, 8);
      ins.run(7,'Stone Titan',     '⛰️',500,28,68, 5,8,480,1,10,30);
      // Lvl 8
      ins.run(8,'Demon',           '😈', 80,18,70,12,7,75,0,11, 8);
      ins.run(8,'Arch Demon',      '👿',640,34,73,10,9,640,1,11,25);
      // Lvl 9
      ins.run(9,'Shadow Beast',    '🌑',100,23,72,16,8,100,0,11, 8);
      ins.run(9,'Shadow King',     '👁️',800,42,75,14,11,820,1,11,25);
      // Lvl 10
      ins.run(10,'Dragon Spawn',   '🐉',130,30,75,18,10,135,0,11,10);
      ins.run(10,'Ancient Dragon', '🐲',1000,52,78,16,13,1000,1,11,40);
    });
  }
}

module.exports = { db, transaction };
