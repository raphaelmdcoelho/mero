import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

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

describe('helpers.fullChar', () => {
  it('returns enriched character with all equipment when slots are set', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })  // characters
      .mockResolvedValueOnce({ rows: [] })           // inventory
      .mockResolvedValueOnce({ rows: [] })           // farm_queue
      .mockResolvedValueOnce({ rows: [] })           // dungeon_run
      .mockResolvedValueOnce({ rows: [weapon] })    // weapon
      .mockResolvedValueOnce({ rows: [armor] })     // armor
      .mockResolvedValueOnce({ rows: [shield] });   // shield

    const result = await fullChar(10);

    expect(result.id).toBe(10);
    expect(result.equippedWeapon).toEqual(weapon);
    expect(result.equippedArmor).toEqual(armor);
    expect(result.equippedShield).toEqual(shield);
    expect(result.inventory).toEqual([]);
    expect(result.farmQueue).toEqual([]);
    expect(result.dungeonRun).toBeNull();
  });

  it('returns null for equipment slots that are not set', async () => {
    const charNoEquip = { ...baseChar, weapon_id: null, armor_id: null, shield_id: null };
    executeSpy
      .mockResolvedValueOnce({ rows: [charNoEquip] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await fullChar(10);

    expect(result.equippedWeapon).toBeNull();
    expect(result.equippedArmor).toBeNull();
    expect(result.equippedShield).toBeNull();
    expect(executeSpy).toHaveBeenCalledTimes(4);
  });

  it('returns {} when character row does not exist (no error thrown)', async () => {
    executeSpy
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

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
    executeSpy
      .mockResolvedValueOnce({ rows: [baseChar] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [run] })
      .mockResolvedValueOnce({ rows: [weapon] })
      .mockResolvedValueOnce({ rows: [armor] })
      .mockResolvedValueOnce({ rows: [shield] })
      .mockResolvedValueOnce({ rows: [monster] });

    const result = await fullChar(10);

    expect(result.dungeonRun).not.toBeNull();
    expect(result.dungeonRun.monster).toEqual(monster);
    expect(result.dungeonRun.kills).toBe(0);
  });

  it('returns farm_queue items sorted by id', async () => {
    const farmItems = [
      { id: 1, plant_type: 'carrot', ready_at: 1000, remaining_seconds: 400 },
      { id: 2, plant_type: 'apple',  ready_at: 2000, remaining_seconds: 200 },
    ];
    const charNoEquip = { ...baseChar, weapon_id: null, armor_id: null, shield_id: null };
    executeSpy
      .mockResolvedValueOnce({ rows: [charNoEquip] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: farmItems })
      .mockResolvedValueOnce({ rows: [] });

    const result = await fullChar(10);

    expect(result.farmQueue).toHaveLength(2);
    expect(result.farmQueue[0].plant_type).toBe('carrot');
    expect(result.farmQueue[1].plant_type).toBe('apple');
  });
});
