import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { routeSql } from './db-mock.js';

// ── Load CJS server modules via require (shares Node module cache) ────────────

const require = createRequire(import.meta.url);
const db = require('../server/db.js');
const { fullChar } = require('../server/helpers.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseChar = {
  id: 10, user_id: 1, name: 'Hero', class: 'Warrior',
  level: 5, xp: 0, xp_to_next: 130, hp: 35, max_hp: 35,
  weapon_id: 1, armor_id: 3, shield_id: 12,
};

const weapon = { id: 1, name: 'Wooden Sword', type: 'weapon' };
const armor  = { id: 3, name: 'Leather Armor', type: 'armor' };
const shield = { id: 12, name: 'Oak Shield',   type: 'armor' };

let executeSpy;

beforeEach(() => {
  executeSpy = vi.spyOn(db.client, 'execute');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

const itemById = items => args => ({ rows: [items.find(i => i.id === args[0]) ?? null] });

describe('helpers.fullChar', () => {
  it('returns enriched character with all equipment when slots are set', async () => {
    routeSql(executeSpy, [
      [/FROM characters WHERE id/, { rows: [baseChar] }],
      [/FROM items WHERE id/,      itemById([weapon, armor, shield])],
    ]);

    const result = await fullChar(10);

    expect(result.id).toBe(10);
    expect(result.equippedWeapon).toEqual(weapon);
    expect(result.equippedArmor).toEqual(armor);
    expect(result.equippedShield).toEqual(shield);
    expect(result.inventory).toEqual([]);
    expect(result.farmQueue).toEqual([]);
    expect(result.dungeonRun).toBeNull();
    expect(result.soloBattle).toBeNull();
  });

  it('returns null for equipment slots that are not set', async () => {
    const charNoEquip = { ...baseChar, weapon_id: null, armor_id: null, shield_id: null };
    routeSql(executeSpy, [[/FROM characters WHERE id/, { rows: [charNoEquip] }]]);

    const result = await fullChar(10);

    expect(result.equippedWeapon).toBeNull();
    expect(result.equippedArmor).toBeNull();
    expect(result.equippedShield).toBeNull();
    expect(result.equippedArm).toBeNull();
    expect(result.equippedBoots).toBeNull();
    expect(result.equippedHelmet).toBeNull();
    // No equipped item ids -> no per-item lookups at all.
    const itemLookups = executeSpy.mock.calls.filter(c => /FROM items WHERE id/.test(c[0].sql));
    expect(itemLookups).toHaveLength(0);
  });

  it('looks up arm, boots and helmet when those slots are set', async () => {
    const arm    = { id: 20, name: 'Iron Gauntlets', type: 'armor' };
    const boots  = { id: 21, name: 'Leather Boots',  type: 'armor' };
    const helmet = { id: 22, name: 'Horned Helmet',  type: 'armor' };
    routeSql(executeSpy, [
      [/FROM characters WHERE id/, { rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null, arm_id: 20, boots_id: 21, helmet_id: 22 }] }],
      [/FROM items WHERE id/,      itemById([arm, boots, helmet])],
    ]);

    const result = await fullChar(10);

    expect(result.equippedArm).toEqual(arm);
    expect(result.equippedBoots).toEqual(boots);
    expect(result.equippedHelmet).toEqual(helmet);
  });

  it('returns {} when character row does not exist (no error thrown)', async () => {
    routeSql(executeSpy, []);

    const result = await fullChar(999);

    expect(result).toMatchObject({
      inventory:      [],
      farmQueue:      [],
      dungeonRun:     null,
      equippedWeapon: null,
      equippedArmor:  null,
      equippedShield: null,
    });
  });

  it('populates dungeonRun with monster when a run is active', async () => {
    const run = { id: 1, character_id: 10, monster_id: 5, dungeon_level: 1, kills: 0, monster_hp: 12 };
    const monster = { id: 5, name: 'Goblin', hp: 12 };
    routeSql(executeSpy, [
      [/FROM characters WHERE id/, { rows: [baseChar] }],
      [/FROM items WHERE id/,      itemById([weapon, armor, shield])],
      [/FROM dungeon_run/,         { rows: [run] }],
      [/FROM monsters WHERE id/,   { rows: [monster] }],
    ]);

    const result = await fullChar(10);

    expect(result.dungeonRun).not.toBeNull();
    expect(result.dungeonRun.monster).toEqual(monster);
    expect(result.dungeonRun.kills).toBe(0);
  });

  it('returns farm_queue items in the order the query returns them', async () => {
    const farmItems = [
      { id: 1, plant_type: 'carrot', ready_at: 1000, remaining_seconds: 400 },
      { id: 2, plant_type: 'apple',  ready_at: 2000, remaining_seconds: 200 },
    ];
    routeSql(executeSpy, [
      [/FROM characters WHERE id/, { rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null }] }],
      [/FROM farm_queue/,          { rows: farmItems }],
    ]);

    const result = await fullChar(10);

    expect(result.farmQueue).toHaveLength(2);
    expect(result.farmQueue[0].plant_type).toBe('carrot');
    expect(result.farmQueue[1].plant_type).toBe('apple');
  });

  it('derives farm level, xp and xp-to-next from the character row', async () => {
    routeSql(executeSpy, [
      [/FROM characters WHERE id/, { rows: [{ ...baseChar, weapon_id: null, armor_id: null, shield_id: null, farm_level: 4, farm_xp: 7 }] }],
    ]);

    const result = await fullChar(10);

    expect(result.farmLevel).toBe(4);
    expect(result.farmXp).toBe(7);
    expect(result.farmXpToNext).toBe(20);
  });
});
