const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { db, transaction } = require('../db');
const protect = require('../middleware/protect');

const router = express.Router();

// Ensure avatars directory exists
const AVATARS_DIR = path.join(__dirname, '..', '..', 'public', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

// Multer: memory storage so we can validate before writing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB
  fileFilter(req, file, cb) {
    if (file.mimetype !== 'image/jpeg') {
      return cb(new Error('Only JPEG images are accepted'));
    }
    cb(null, true);
  },
});

function ownedCharacter(req, res) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!char) res.status(404).json({ error: 'Character not found' });
  return char || null;
}

function toObj(row) {
  return row ? Object.assign({}, row) : null;
}

function enrichCharacter(char) {
  const c = toObj(char);
  const inventoryRows = db.prepare(`
    SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon
    FROM inventory inv
    JOIN items i ON i.id = inv.item_id
    WHERE inv.character_id = ?
  `).all(c.id).map(toObj);

  const weapon = c.weapon_id
    ? toObj(db.prepare('SELECT * FROM items WHERE id = ?').get(c.weapon_id))
    : null;
  const armor = c.armor_id
    ? toObj(db.prepare('SELECT * FROM items WHERE id = ?').get(c.armor_id))
    : null;

  return { ...c, inventory: inventoryRows, equippedWeapon: weapon, equippedArmor: armor };
}

// All routes require auth
router.use(protect);

// GET /api/characters
router.get('/', (req, res) => {
  const chars = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY created_at ASC')
    .all(req.user.userId);
  res.json(chars.map(r => enrichCharacter(toObj(r))));
});

// POST /api/characters
router.post('/', (req, res) => {
  const { name, class: cls } = req.body;
  const VALID_CLASSES = ['Warrior', 'Mage', 'Rogue', 'Cleric'];

  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 30) {
    return res.status(400).json({ error: 'Name must be 1–30 characters' });
  }
  if (!VALID_CLASSES.includes(cls)) {
    return res.status(400).json({ error: 'Invalid class' });
  }

  try {
    const char = transaction(() => {
      const result = db.prepare(`
        INSERT INTO characters (user_id, name, class, weapon_id, armor_id)
        VALUES (?, ?, ?, 1, 3)
      `).run(req.user.userId, name.trim(), cls);

      const charId = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, 1, 1)').run(charId);
      db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, 3, 1)').run(charId);

      return db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
    });

    res.status(201).json(enrichCharacter(toObj(char)));
  } catch (err) {
    res.status(500).json({ error: 'Could not create character' });
  }
});

// DELETE /api/characters/:id
router.delete('/:id', (req, res) => {
  const char = ownedCharacter(req, res);
  if (!char) return;

  transaction(() => {
    db.prepare('DELETE FROM inventory WHERE character_id = ?').run(char.id);
    db.prepare('DELETE FROM characters WHERE id = ?').run(char.id);
  });

  res.json({ ok: true });
});

// POST /api/characters/:id/avatar
router.post('/:id/avatar', (req, res) => {
  const char = ownedCharacter(req, res);
  if (!char) return;

  upload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image must be under 1 MB' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = `${uuidv4()}.jpg`;
    const filepath = path.join(AVATARS_DIR, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    // Delete old avatar if exists
    if (char.avatar_path) {
      const old = path.join(__dirname, '..', '..', 'public', char.avatar_path);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    const avatarPath = `/avatars/${filename}`;
    db.prepare('UPDATE characters SET avatar_path = ? WHERE id = ?').run(avatarPath, char.id);
    res.json({ avatarPath });
  });
});

// PUT /api/characters/:id/equip
router.put('/:id/equip', (req, res) => {
  const char = ownedCharacter(req, res);
  if (!char) return;

  const { slot, item_id } = req.body;
  if (!['weapon', 'armor'].includes(slot)) {
    return res.status(400).json({ error: 'slot must be "weapon" or "armor"' });
  }
  if (!item_id) {
    return res.status(400).json({ error: 'item_id required' });
  }

  const invRow = db.prepare(
    'SELECT inv.id FROM inventory inv JOIN items i ON i.id = inv.item_id WHERE inv.character_id = ? AND inv.item_id = ? AND i.type = ?'
  ).get(char.id, item_id, slot);

  if (!invRow) {
    return res.status(400).json({ error: 'Item not in inventory or wrong type' });
  }

  const col = slot === 'weapon' ? 'weapon_id' : 'armor_id';
  db.prepare(`UPDATE characters SET ${col} = ? WHERE id = ?`).run(item_id, char.id);

  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(char.id);
  res.json(enrichCharacter(toObj(updated)));
});

// PUT /api/characters/:id/attributes
// body: { allocations: { strength: 2, vitality: 3, ... } }
const VALID_ATTRS = ['strength','dexterity','agility','vitality','intelligence','focus','stamina','resistance'];

router.put('/:id/attributes', (req, res) => {
  const char = ownedCharacter(req, res);
  if (!char) return;

  const { allocations } = req.body;
  if (!allocations || typeof allocations !== 'object') {
    return res.status(400).json({ error: 'allocations object required' });
  }

  // Validate keys and values
  for (const [key, val] of Object.entries(allocations)) {
    if (!VALID_ATTRS.includes(key)) {
      return res.status(400).json({ error: `Unknown attribute: ${key}` });
    }
    if (!Number.isInteger(val) || val < 0) {
      return res.status(400).json({ error: `Value for ${key} must be a non-negative integer` });
    }
  }

  const total = Object.values(allocations).reduce((s, v) => s + v, 0);
  const unspent = Number(char.unspent_points) || 0;

  if (total > unspent) {
    return res.status(400).json({ error: `Not enough unspent points (have ${unspent}, need ${total})` });
  }
  if (total === 0) {
    return res.status(400).json({ error: 'No points allocated' });
  }

  // Build SET clause dynamically (safe — keys validated against allowlist above)
  const sets = Object.entries(allocations)
    .filter(([, v]) => v > 0)
    .map(([key]) => `attr_${key} = attr_${key} + ?`)
    .join(', ');
  const vals = Object.entries(allocations)
    .filter(([, v]) => v > 0)
    .map(([, v]) => v);

  db.prepare(`UPDATE characters SET ${sets}, unspent_points = unspent_points - ? WHERE id = ?`)
    .run(...vals, total, char.id);

  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(char.id);
  res.json(enrichCharacter(toObj(updated)));
});

module.exports = router;
