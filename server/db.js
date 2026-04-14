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

module.exports = { db, transaction };
