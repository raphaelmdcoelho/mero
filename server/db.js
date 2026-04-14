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
    hp                  REAL    NOT NULL DEFAULT 10,
    max_hp              INTEGER NOT NULL DEFAULT 10,
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

// New tables for farming feature (idempotent)
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

// Additive migrations — safe to run on existing DBs (try/catch ignores "column exists")
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
  'ALTER TABLE characters ADD COLUMN reading_points_awarded INTEGER DEFAULT 0',
];

for (const sql of additiveMigrations) {
  try { db.exec(sql); } catch { /* column already exists — skip */ }
}

// Seed starter items if table is empty
const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM items').get();
if (itemCount.cnt === 0) {
  transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO items (id, name, type, description, icon) VALUES (?, ?, ?, ?, ?)');
    ins.run(1, 'Wooden Sword',  'weapon',     'A basic training sword.',  '🗡️');
    ins.run(2, 'Iron Sword',    'weapon',     'A sturdy iron blade.',     '⚔️');
    ins.run(3, 'Leather Armor', 'armor',      'Light but protective.',    '🥋');
    ins.run(4, 'Iron Shield',   'armor',      'Heavy iron shield.',       '🛡️');
    ins.run(5, 'Health Potion', 'consumable', 'Restores 5 HP.',           '🧪');
  });
}

// Seed farm consumables (safe to run on every startup — INSERT OR IGNORE)
{
  const ins = db.prepare('INSERT OR IGNORE INTO items (id, name, type, description, icon) VALUES (?, ?, ?, ?, ?)');
  ins.run(6, 'Carrot', 'consumable', 'Restores 2 HP.', '🥕');
  ins.run(7, 'Apple',  'consumable', 'Restores 1 HP.', '🍎');
}

module.exports = { db, transaction };
