'use strict';
const express = require('express');
const { client } = require('../db');

const router = express.Router();

router.get('/leaderboard', async (req, res) => {
  const db = client;
  const { rows } = await db.execute(`
    SELECT
      c.name        AS character_name,
      u.username,
      c.class,
      c.level,
      c.hp,
      COALESCE(c.attr_strength,  5) AS attack,
      COALESCE(c.attr_agility,   5) AS agility,
      COALESCE(c.attr_dexterity, 5) AS dexterity,
      COALESCE(c.gold,           0) AS gold
    FROM characters c
    JOIN users u ON u.id = c.user_id
    ORDER BY
      c.level       DESC,
      c.hp          DESC,
      c.attr_strength  DESC,
      c.attr_agility   DESC,
      c.attr_dexterity DESC,
      c.gold        DESC
    LIMIT 10
  `);
  res.json(rows);
});

module.exports = router;
