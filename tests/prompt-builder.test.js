import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const PB = require('../tools/avatar-canvas/prompt-builder.js');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../tools/avatar-canvas/prompts.json'), 'utf8'));

describe('slugify / titleCase', () => {
  it('normalises names the way public/items files are named', () => {
    expect(PB.slugify('dragon-armor')).toBe('dragon_armor');
    expect(PB.slugify('  Samurai Helmet! ')).toBe('samurai_helmet');
    expect(PB.titleCase('dragon-armor')).toBe('Dragon Armor');
  });
});

describe('render', () => {
  it('fills variables and keeps/drops conditional blocks', () => {
    expect(PB.render('Hi {{a}}{{#b}} and {{b}}{{/b}}!', { a: 'X', b: '' })).toBe('Hi X!');
    expect(PB.render('Hi {{a}}{{#b}} and {{b}}{{/b}}!', { a: 'X', b: 'Y' })).toBe('Hi X and Y!');
    expect(PB.render('{{missing}}|', {})).toBe('|');
  });
});

describe('build', () => {
  const base = { slot: 'armor', name: 'dragon-armor', style: 'dragon', gender: 'both', details: '', reference: false, chroma: false };

  it('requires name, style and slot', () => {
    expect(PB.build(cfg, { ...base, name: '' }).errors.length).toBe(1);
    expect(PB.build(cfg, { ...base, style: ' ' }).errors.length).toBe(1);
    expect(PB.build(cfg, { ...base, slot: 'nope' }).errors.length).toBeGreaterThan(0);
  });

  it('makes a male and a female prompt for gendered slots, with size, transparency and style', () => {
    const r = PB.build(cfg, base);
    expect(r.prompts.map(p => p.version)).toEqual(['male', 'female']);
    const male = r.prompts[0].text;
    expect(male).toContain('Dragon Armor');
    expect(male).toContain('dragon');
    expect(male).toContain('1024 × 1536');
    expect(male).toMatch(/TRANSPARENT/);
    expect(male).toContain('16-bit-inspired HD pixel-art');
    expect(male).toContain('male silhouette');
    expect(r.prompts[1].text).toContain('female silhouette');
    expect(r.prompts[1].file).toBe('public/items/dragon_armor_female.png');
    expect(male).not.toMatch(/\{\{|\}\}/);
  });

  it('uses the right canvas per slot', () => {
    const size = slot => { const p = PB.build(cfg, { ...base, slot, gender: 'male' }).prompts[0]; return [p.width, p.height]; };
    expect(size('armor')).toEqual([1024, 1536]);
    expect(size('shield')).toEqual([1024, 1024]);
    expect(size('gauntlet')).toEqual([1536, 1024]);
    expect(size('boots')).toEqual([1024, 1536]);
    expect(size('helmet')).toEqual([1024, 1536]);
  });

  it('shared slots (helmet, shield) produce a single prompt even for "both"', () => {
    const r = PB.build(cfg, { ...base, slot: 'helmet', name: 'samurai helmet', style: 'samurai' });
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0].version).toBe('shared');
    expect(r.notes.some(n => /mesmo desenho/.test(n))).toBe(true);
  });

  it('optional details only appear when given', () => {
    expect(PB.build(cfg, base).prompts[0].text).not.toContain('Extra details');
    expect(PB.build(cfg, { ...base, details: 'glowing red runes' }).prompts[0].text).toContain('Extra details: glowing red runes');
  });

  it('chroma mode swaps the background instruction', () => {
    const t = PB.build(cfg, { ...base, chroma: true }).prompts[0].text;
    expect(t).toContain('#FF00FF');
    expect(t).not.toMatch(/fully TRANSPARENT/);
  });

  it('reference mode targets the avatar canvas and explains alignment', () => {
    const r = PB.build(cfg, { ...base, slot: 'shield', reference: true, gender: 'male' });
    expect(r.prompts[0].width).toBe(1024);
    expect(r.prompts[0].height).toBe(1536);
    expect(r.prompts[0].text).toContain('REFERENCE IMAGE');
    expect(r.notes.some(n => /Já desenhado no canvas do avatar/.test(n))).toBe(true);
  });

  it('every slot in prompts.json builds cleanly with no leftover placeholders', () => {
    for (const slot of Object.keys(cfg.slots)) {
      for (const reference of [false, true]) {
        const r = PB.build(cfg, { ...base, slot, reference });
        expect(r.errors).toEqual([]);
        for (const p of r.prompts) expect(p.text, `${slot} ref=${reference}`).not.toMatch(/\{\{|\}\}/);
      }
    }
  });
});
