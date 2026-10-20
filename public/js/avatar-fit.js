/**
 * Avatar fit — places equipment sprites on a character without hand-tuned CSS.
 *
 * Used by BOTH the game (renderCharAvatar) and the Avatar Studio, so what you
 * approve in the studio is exactly what players see.
 *
 * The idea, in three layers (most general → most specific):
 *   1. LANDMARKS  per avatar  — boxes marking head / torso / hands / feet / shield
 *                               on that body (the only thing measured by hand, once).
 *   2. RULES      per slot    — how a sprite's *visible* area is fitted into a landmark
 *                               (fit mode, anchor, scale, offset). Fixes a whole slot at once.
 *   3. OVERRIDES  per avatar+sprite — rare manual nudges (dx, dy, scale).
 *
 * A sprite PNG usually has transparent margins, so we never fit the PNG itself —
 * we fit its visible bounding box ("box", measured from the alpha channel).
 *
 * Coordinates: landmarks and results are percentages of the avatar canvas
 * (the 1024×1536 PNG). x is % of width, y is % of height. The overlay <img>
 * is the WHOLE sprite PNG, positioned so that its visible box lands on target.
 *
 * Works in the browser (global `AvatarFit`) and in Node (`require`) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvatarFit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Avatar canvas is 1024×1536, so 1% of height is 1.5× longer than 1% of width.
  const CANVAS_W = 1024;
  const CANVAS_H = 1536;
  const K = CANVAS_H / CANVAS_W;

  const DATA_URL = '/data/avatar-fit.json';
  const REGIONS = ['head', 'torso', 'hands', 'feet', 'shield'];
  const FIT_MODES = ['width', 'height', 'contain', 'cover'];

  let data = null;
  let loading = null;

  /** Fetch + cache the fit data. Resolves to the data (or null if unavailable). */
  function load(url) {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = fetch(url || DATA_URL, { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { data = d; return d; })
        .catch(() => null);
    }
    return loading;
  }
  function setData(d) { data = d; }
  function getData() { return data; }

  /** '/avatars/selection/female_selection_B.png' → 'female_B' (falls back to '<gender>_A'). */
  function avatarKeyFromPath(path, gender) {
    const m = /(male|female)_selection_([A-Z])\.png/i.exec(path || '');
    if (m) return `${m[1].toLowerCase()}_${m[2].toUpperCase()}`;
    return `${gender === 'female' ? 'female' : 'male'}_A`;
  }

  /** Visible box of a sprite, in sprite pixels: {l, t, r, b, bw, bh, iw, ih}. */
  function spriteBox(sprite) {
    if (!sprite || !sprite.box) return null;
    const [l, t, r, b] = sprite.box;
    if (r <= l || b <= t) return null;
    return { l, t, r, b, bw: r - l, bh: b - t, iw: sprite.w, ih: sprite.h };
  }

  function round(n) { return Math.round(n * 100) / 100; }

  /**
   * Where the sprite's visible box lands, in canvas % — {x, y, w, h}.
   * Also returns the whole-PNG rectangle (`el`) used to position the <img>.
   * Returns null when there is nothing to fit (no data / no box / unknown landmark).
   */
  function compute(opts) {
    const fit = opts.fit || data;
    if (!fit) return null;
    const { avatarKey, slot, src } = opts;
    const sprite = fit.sprites && fit.sprites[src];

    // Sprites drawn on the avatar's own canvas need no fitting at all.
    if (sprite && sprite.prealigned) {
      const full = { x: 0, y: 0, w: 100, h: 100 };
      return { box: full, el: { left: 0, top: 0, width: 100, height: 100 }, prealigned: true };
    }

    const sb = spriteBox(sprite);
    const rule = fit.rules && fit.rules[slot];
    const lm = fit.avatars && fit.avatars[avatarKey];
    if (!sb || !rule || !lm) return null;
    const region = lm[rule.region];
    if (!region) return null;

    const ov = (fit.overrides && fit.overrides[`${avatarKey}|${src}`]) || {};
    const scale = (rule.scale == null ? 1 : rule.scale) * (ov.scale == null ? 1 : ov.scale);
    const dx = (rule.dx || 0) + (ov.dx || 0);
    const dy = (rule.dy || 0) + (ov.dy || 0);
    const ax = rule.anchor ? rule.anchor.x : 0.5;
    const ay = rule.anchor ? rule.anchor.y : 0.5;

    // Work in "width units": 1 unit = 1% of canvas width, so vertical % is multiplied by K.
    const aspect = sb.bw / sb.bh;
    const rw = region.w;
    const rh = region.h * K;
    let sw;
    switch (rule.fit) {
      case 'height':  sw = rh * aspect; break;
      case 'contain': sw = Math.min(rw, rh * aspect); break;
      case 'cover':   sw = Math.max(rw, rh * aspect); break;
      default:        sw = rw;                       // 'width'
    }
    sw *= scale;
    const sh = sw / aspect;

    const boxX = region.x + (rw - sw) * ax + dx;
    const boxYu = region.y * K + (rh - sh) * ay + dy * K;

    // Whole-PNG rectangle: sprite px → units
    const f = sw / sb.bw;
    const elLeft = boxX - sb.l * f;
    const elTopU = boxYu - sb.t * f;
    return {
      box: { x: round(boxX), y: round(boxYu / K), w: round(sw), h: round(sh / K) },
      el: {
        left: round(elLeft),
        top: round(elTopU / K),
        width: round(sb.iw * f),
        height: round((sb.ih * f) / K),
      },
      prealigned: false,
    };
  }

  /** CSS declarations for the overlay <img> (percentages of the avatar stage). */
  function overlayStyle(result) {
    if (!result) return '';
    const e = result.el;
    return `left:${e.left}%;top:${e.top}%;width:${e.width}%;height:${e.height}%;`;
  }

  // ── Checks (used by the studio's "Check all" grid) ──────────────────────────

  function intersectionArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /**
   * Returns a list of human-readable problems ([] = looks good).
   * `result` is the return value of compute().
   */
  function check(opts, result) {
    const fit = opts.fit || data;
    const problems = [];
    if (!result) { return ['sem dados para encaixar (falta caixa do sprite, regra do slot ou landmark do avatar)']; }
    if (result.prealigned) return problems;
    const rule = fit.rules[opts.slot];
    const region = fit.avatars[opts.avatarKey][rule.region];
    const chk = rule.check || {};
    const b = result.box;

    const cov = intersectionArea(b, region) / (region.w * region.h);
    const minCov = chk.minCoverage == null ? 0.85 : chk.minCoverage;
    if (cov < minCov) {
      problems.push(`cobre só ${Math.round(cov * 100)}% de "${rule.region}" (mínimo ${Math.round(minCov * 100)}%)`);
    }
    const wr = b.w / region.w;
    const maxW = chk.maxWidthRatio == null ? 1.6 : chk.maxWidthRatio;
    const minW = chk.minWidthRatio == null ? 0.9 : chk.minWidthRatio;
    if (wr > maxW) problems.push(`largura ${Math.round(wr * 100)}% de "${rule.region}" — grande demais`);
    if (wr < minW) problems.push(`largura ${Math.round(wr * 100)}% de "${rule.region}" — menor que o corpo`);

    const cx = b.x + b.w / 2;
    const rcx = region.x + region.w / 2;
    const maxOff = chk.maxCenterOffset == null ? 0.2 : chk.maxCenterOffset;
    if (Math.abs(cx - rcx) > region.w * maxOff) {
      problems.push(`descentralizado ${round(cx - rcx)}% em relação a "${rule.region}"`);
    }
    if (b.x < -2 || b.y < -2 || b.x + b.w > 102 || b.y + b.h > 102) {
      problems.push('sai da área do avatar');
    }
    return problems;
  }

  return {
    CANVAS_W, CANVAS_H, K, REGIONS, FIT_MODES, DATA_URL,
    load, setData, getData,
    avatarKeyFromPath, spriteBox, compute, overlayStyle, check, intersectionArea,
  };
});
