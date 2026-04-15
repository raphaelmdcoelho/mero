'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { client, transaction } = require('../db');
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

async function ownedCharacter(req, res) {
  const r = await client.execute({
    sql:  'SELECT * FROM characters WHERE id = ? AND user_id = ?',
    args: [req.params.id, req.user.userId],
  });
  const char = r.rows[0] ?? null;
  if (!char) res.status(404).json({ error: 'Character not found' });
  return char ? Object.assign({}, char) : null;
}

function toObj(row) {
  return row ? Object.assign({}, row) : null;
}

async function enrichCharacter(char) {
  const c = toObj(char);
  const invR = await client.execute({
    sql: `SELECT inv.id, inv.quantity, i.id as item_id, i.name, i.type, i.description, i.icon
          FROM inventory inv
          JOIN items i ON i.id = inv.item_id
          WHERE inv.character_id = ?`,
    args: [c.id],
  });
  const inventoryRows = invR.rows.map(toObj);

  const [weapR, armR] = await Promise.all([
    c.weapon_id ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [c.weapon_id] }) : Promise.resolve({ rows: [null] }),
    c.armor_id  ? client.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [c.armor_id] })  : Promise.resolve({ rows: [null] }),
  ]);

  const weapon = weapR.rows[0] ? toObj(weapR.rows[0]) : null;
  const armor  = armR.rows[0]  ? toObj(armR.rows[0])  : null;

  return { ...c, inventory: inventoryRows, equippedWeapon: weapon, equippedArmor: armor };
}

// All routes require auth
router.use(protect);

// GET /api/characters
router.get('/', async (req, res) => {
  const r = await client.execute({
    sql:  'SELECT * FROM characters WHERE user_id = ? ORDER BY created_at ASC',
    args: [req.user.userId],
  });
  const enriched = await Promise.all(r.rows.map(row => enrichCharacter(toObj(row))));
  res.json(enriched);
});

// POST /api/characters
router.post('/', async (req, res) => {
  const { name, class: cls } = req.body;
  const VALID_CLASSES = ['Warrior', 'Mage', 'Rogue', 'Cleric'];

  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 30) {
    return res.status(400).json({ error: 'Name must be 1–30 characters' });
  }
  if (!VALID_CLASSES.includes(cls)) {
    return res.status(400).json({ error: 'Invalid class' });
  }

  try {
    const char = await transaction(async (tx) => {
      const result = await tx.execute({
        sql:  'INSERT INTO characters (user_id, name, class, weapon_id, armor_id) VALUES (?, ?, ?, 1, 3)',
        args: [req.user.userId, name.trim(), cls],
      });
      const charId = Number(result.lastInsertRowid);
      await tx.execute({
        sql:  'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, 1, 1)',
        args: [charId],
      });
      await tx.execute({
        sql:  'INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, 3, 1)',
        args: [charId],
      });
      const sel = await tx.execute({
        sql:  'SELECT * FROM characters WHERE id = ?',
        args: [charId],
      });
      return sel.rows[0];
    });

    res.status(201).json(await enrichCharacter(toObj(char)));
  } catch (err) {
    res.status(500).json({ error: 'Could not create character' });
  }
});

// DELETE /api/characters/:id
router.delete('/:id', async (req, res) => {
  const char = await ownedCharacter(req, res);
  if (!char) return;

  await client.batch([
    { sql: 'DELETE FROM inventory WHERE character_id = ?', args: [char.id] },
    { sql: 'DELETE FROM characters WHERE id = ?',          args: [char.id] },
  ], 'write');

  res.json({ ok: true });
});

// POST /api/characters/:id/avatar/preset  — store a DiceBear URL as avatar
router.post('/:id/avatar/preset', (req, res) => {
  const char = ownedCharacter(req, res);
  if (!char) return;

  const { presetUrl } = req.body;
  if (
    typeof presetUrl !== 'string' ||
    !presetUrl.startsWith('https://api.dicebear.com/')
  ) {
    return res.status(400).json({ error: 'Invalid preset URL' });
  }

  // Clean up any previously uploaded (local) avatar
  if (char.avatar_path && !char.avatar_path.startsWith('https://')) {
    const old = path.join(__dirname, '..', '..', 'public', char.avatar_path);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  db.prepare('UPDATE characters SET avatar_path = ? WHERE id = ?').run(presetUrl, char.id);
  res.json({ avatarPath: presetUrl });
});

// POST /api/characters/:id/avatar
router.post('/:id/avatar', async (req, res) => {
  const char = await ownedCharacter(req, res);
  if (!char) return;

  let multerErr = null;
  await new Promise(resolve => {
    upload.single('avatar')(req, res, err => { multerErr = err || null; resolve(); });
  });

  if (multerErr) {
    if (multerErr.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image must be under 1 MB' });
    return res.status(400).json({ error: multerErr.message });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filename = `${uuidv4()}.jpg`;
  const filepath = path.join(AVATARS_DIR, filename);
  fs.writeFileSync(filepath, req.file.buffer);

  if (char.avatar_path) {
    const old = path.join(__dirname, '..', '..', 'public', char.avatar_path);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  const avatarPath = `/avatars/${filename}`;
  await client.execute({
    sql:  'UPDATE characters SET avatar_path = ? WHERE id = ?',
    args: [avatarPath, char.id],
  });
  res.json({ avatarPath });
});

// PUT /api/characters/:id/equip
router.put('/:id/equip', async (req, res) => {
  const char = await ownedCharacter(req, res);
  if (!char) return;

  const { slot, item_id } = req.body;
  if (!['weapon', 'armor'].includes(slot)) {
    return res.status(400).json({ error: 'slot must be "weapon" or "armor"' });
  }
  if (!item_id) {
    return res.status(400).json({ error: 'item_id required' });
  }

  const invR = await client.execute({
    sql:  'SELECT inv.id FROM inventory inv JOIN items i ON i.id = inv.item_id WHERE inv.character_id = ? AND inv.item_id = ? AND i.type = ?',
    args: [char.id, item_id, slot],
  });
  if (!invR.rows.length) {
    return res.status(400).json({ error: 'Item not in inventory or wrong type' });
  }

  const col = slot === 'weapon' ? 'weapon_id' : 'armor_id';
  await client.execute({
    sql:  `UPDATE characters SET ${col} = ? WHERE id = ?`,
    args: [item_id, char.id],
  });

  const updR = await client.execute({ sql: 'SELECT * FROM characters WHERE id = ?', args: [char.id] });
  res.json(await enrichCharacter(toObj(updR.rows[0])));
});

// PUT /api/characters/:id/attributes
// body: { allocations: { strength: 2, vitality: 3, ... } }
const VALID_ATTRS = ['strength','dexterity','agility','vitality','intelligence','focus','stamina','resistance'];

router.put('/:id/attributes', async (req, res) => {
  const char = await ownedCharacter(req, res);
  if (!char) return;

  const { allocations } = req.body;
  if (!allocations || typeof allocations !== 'object') {
    return res.status(400).json({ error: 'allocations object required' });
  }

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

  await client.execute({
    sql:  `UPDATE characters SET ${sets}, unspent_points = unspent_points - ? WHERE id = ?`,
    args: [...vals, total, char.id],
  });

  // Recalculate max_hp if vitality was changed (max_hp = 10 + (level-1)*5 + vitality*2)
  if (allocations.vitality) {
    await client.execute({
      sql: `UPDATE characters
            SET max_hp = 10 + (level - 1) * 5 + attr_vitality * 2,
                hp     = MIN(hp + ?, 10 + (level - 1) * 5 + attr_vitality * 2)
            WHERE id = ?`,
      args: [allocations.vitality * 2, char.id],
    });
  }

  const updR = await client.execute({ sql: 'SELECT * FROM characters WHERE id = ?', args: [char.id] });
  res.json(await enrichCharacter(toObj(updR.rows[0])));
});

module.exports = router;
