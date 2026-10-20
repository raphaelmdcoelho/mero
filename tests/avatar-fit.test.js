import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const AvatarFit = require('../public/js/avatar-fit.js');

// A tiny fit set whose numbers are easy to verify by hand.
// Canvas 1024×1536 → K = 1.5 (1% of height = 1.5 width-units).
function makeFit(over = {}) {
  return {
    rules: {
      armor: { region: 'torso', fit: 'width', anchor: { x: 0.5, y: 0 }, scale: 1, dx: 0, dy: 0 },
      boots: { region: 'feet', fit: 'contain', anchor: { x: 0.5, y: 1 }, scale: 1, dx: 0, dy: 0 },
    },
    avatars: {
      male_A: {
        torso: { x: 30, y: 30, w: 40, h: 20 },
        feet:  { x: 30, y: 70, w: 40, h: 20 },
      },
    },
    // 200×300 sprite whose visible box is 100×100 at (50,100): aspect 1
    sprites: { '/a.png': { w: 200, h: 300, box: [50, 100, 150, 200] } },
    overrides: {},
    ...over,
  };
}
const base = { fit: null, avatarKey: 'male_A', slot: 'armor', src: '/a.png' };

describe('avatarKeyFromPath', () => {
  it('reads style and gender from the selection path', () => {
    expect(AvatarFit.avatarKeyFromPath('/avatars/selection/female_selection_B.png', 'male')).toBe('female_B');
    expect(AvatarFit.avatarKeyFromPath('/avatars/selection/male_selection_C.png')).toBe('male_C');
  });
  it('falls back to <gender>_A for unknown avatars', () => {
    expect(AvatarFit.avatarKeyFromPath('/avatars/presets/mage.svg', 'female')).toBe('female_A');
    expect(AvatarFit.avatarKeyFromPath(null, 'male')).toBe('male_A');
  });
});

describe('compute', () => {
  it("'width' fit makes the visible box exactly as wide as the landmark", () => {
    const r = AvatarFit.compute({ ...base, fit: makeFit() });
    expect(r.box.w).toBe(40);
    expect(r.box.x).toBe(30);
    expect(r.box.y).toBe(30);                 // anchored to the top of the region
    // aspect 1 → height in width-units = 40 → 40/1.5 % of canvas height
    expect(r.box.h).toBeCloseTo(40 / 1.5, 1);
  });

  it('positions the whole PNG so its visible box lands on the target', () => {
    const r = AvatarFit.compute({ ...base, fit: makeFit() });
    const f = 40 / 100;                        // units per sprite pixel
    expect(r.el.width).toBeCloseTo(200 * f, 1);
    expect(r.el.left).toBeCloseTo(30 - 50 * f, 1);          // box.x − box.l·f
    expect(r.el.top).toBeCloseTo(30 - (100 * f) / 1.5, 1);  // vertical converts with K
    expect(r.el.height).toBeCloseTo((300 * f) / 1.5, 1);
  });

  it("'contain' never exceeds the region and honours a bottom anchor", () => {
    const r = AvatarFit.compute({ ...base, slot: 'boots', fit: makeFit() });
    // region 40 wide × 20·1.5=30 tall (units) → limited by height: 30 wide
    expect(r.box.w).toBe(30);
    expect(r.box.y + r.box.h).toBeCloseTo(90, 1);           // bottom-aligned to the region
    expect(r.box.x).toBeCloseTo(35, 1);                     // centred horizontally
  });

  it('applies rule scale, rule offsets and per-sprite overrides', () => {
    const fit = makeFit();
    fit.rules.armor.scale = 1.1;
    fit.rules.armor.dy = -2;
    fit.overrides['male_A|/a.png'] = { scale: 0.5, dx: 3, dy: 1 };
    const r = AvatarFit.compute({ ...base, fit });
    expect(r.box.w).toBeCloseTo(40 * 1.1 * 0.5, 1);
    expect(r.box.y).toBeCloseTo(30 + (-2 + 1), 1);
    expect(r.box.x).toBeCloseTo(30 + (40 - 22) * 0.5 + 3, 1);
  });

  it('overrides are scoped to one avatar', () => {
    const fit = makeFit();
    fit.avatars.male_B = JSON.parse(JSON.stringify(fit.avatars.male_A));
    fit.overrides['male_A|/a.png'] = { scale: 0.5 };
    const a = AvatarFit.compute({ ...base, fit });
    const b = AvatarFit.compute({ ...base, avatarKey: 'male_B', fit });
    expect(a.box.w).toBe(20);
    expect(b.box.w).toBe(40);
  });

  it('pre-aligned sprites fill the whole canvas', () => {
    const fit = makeFit();
    fit.sprites['/a.png'].prealigned = true;
    const r = AvatarFit.compute({ ...base, fit });
    expect(r.el).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('returns null when data is missing', () => {
    expect(AvatarFit.compute({ ...base, fit: makeFit(), src: '/unknown.png' })).toBeNull();
    expect(AvatarFit.compute({ ...base, fit: makeFit(), avatarKey: 'female_Z' })).toBeNull();
    expect(AvatarFit.compute({ ...base, fit: makeFit(), slot: 'helmet' })).toBeNull();
  });

  it('a larger landmark gives a larger sprite (body size drives item size)', () => {
    const small = makeFit();
    const big = makeFit();
    big.avatars.male_A.torso.w = 60;
    expect(AvatarFit.compute({ ...base, fit: big }).box.w).toBeGreaterThan(
      AvatarFit.compute({ ...base, fit: small }).box.w);
  });
});

describe('check', () => {
  it('passes a sprite that matches its landmark', () => {
    const fit = makeFit();
    const r = AvatarFit.compute({ ...base, fit });
    expect(AvatarFit.check({ ...base, fit }, r)).toEqual([]);
  });

  it('flags an armour that is narrower than the torso', () => {
    const fit = makeFit();
    fit.overrides['male_A|/a.png'] = { scale: 0.6 };
    const r = AvatarFit.compute({ ...base, fit });
    const problems = AvatarFit.check({ ...base, fit }, r);
    expect(problems.some(p => /menor que o corpo/.test(p))).toBe(true);
  });

  it('flags a sprite pushed off-centre or off the canvas', () => {
    const fit = makeFit();
    fit.overrides['male_A|/a.png'] = { dx: 40 };
    const r = AvatarFit.compute({ ...base, fit });
    const problems = AvatarFit.check({ ...base, fit }, r);
    expect(problems.some(p => /descentralizado/.test(p))).toBe(true);
    expect(problems.some(p => /sai da área/.test(p))).toBe(true);
  });

  it('reports missing data instead of passing silently', () => {
    expect(AvatarFit.check({ ...base, fit: makeFit() }, null)).toHaveLength(1);
  });
});

describe('shipped data (public/data/avatar-fit.json)', () => {
  const fit = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/avatar-fit.json'), 'utf8'));

  it('every item sprite has a measured box and every avatar has all landmarks', () => {
    for (const it of fit.items) {
      const srcs = it.src ? [it.src] : ['male', 'female'].map(g => `/items/${it.base}_${g}.png`);
      for (const s of srcs) expect(AvatarFit.spriteBox(fit.sprites[s]), s).not.toBeNull();
    }
    for (const [key, lm] of Object.entries(fit.avatars)) {
      for (const r of AvatarFit.REGIONS) expect(lm[r], `${key}.${r}`).toBeDefined();
    }
  });

  it('every item fits on every avatar of the matching gender with no warnings', () => {
    for (const key of Object.keys(fit.avatars)) {
      const gender = key.split('_')[0];
      for (const it of fit.items) {
        const src = it.src || `/items/${it.base}_${gender}.png`;
        const o = { fit, avatarKey: key, slot: it.slot, src };
        const r = AvatarFit.compute(o);
        expect(r, `${key} ${it.id}`).not.toBeNull();
        expect(AvatarFit.check(o, r), `${key} ${it.id}`).toEqual([]);
      }
    }
  });
});
