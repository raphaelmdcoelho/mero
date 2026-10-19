/**
 * Prompt builder — turns tools/avatar-canvas/prompts.json + a few variables
 * (slot, name, style, gender…) into ready-to-paste image-generation prompts.
 *
 * Works in the browser (global `PromptBuilder`) and in Node (`require`) for tests.
 * Dev tool only — not part of the game build.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PromptBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 'dragon-armor' / 'Dragon Armor' → 'dragon_armor' (the file naming used in public/items). */
  function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /** 'dragon-armor' → 'Dragon Armor' */
  function titleCase(name) {
    return String(name || '').trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
      .replace(/\b([a-z])/gi, (_, c) => c.toUpperCase());
  }

  /**
   * Tiny template engine:
   *   {{key}}                  → value (empty string if missing)
   *   {{#key}}...{{/key}}      → block kept only when value is non-empty
   */
  function render(template, vars) {
    let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_, key, inner) => (vars[key] ? inner : ''));
    out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])));
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  const GENDER_LABEL = { male: 'male version', female: 'female version', shared: 'unisex (one version for every character)' };

  /**
   * @param {object} cfg    parsed prompts.json
   * @param {object} input  { slot, name, style, gender: 'male'|'female'|'both', details,
   *                          reference: boolean, chroma: boolean }
   * @returns {{ errors: string[], prompts: Array, notes: string[] }}
   */
  function build(cfg, input) {
    const errors = [];
    const slot = cfg.slots[input.slot];
    if (!slot) errors.push('Escolha o tipo de item.');
    const name = titleCase(input.name);
    const file = slugify(input.name);
    const style = String(input.style || '').trim();
    if (!name) errors.push('Informe o nome do item (ex.: dragon-armor).');
    if (!style) errors.push('Informe o estilo/tema (ex.: dragon, samurai, light).');
    if (errors.length) return { errors, prompts: [], notes: [] };

    const wanted = input.gender === 'both' ? ['male', 'female'] : [input.gender === 'female' ? 'female' : 'male'];
    // Slots whose art is shared by every character need only one image.
    const versions = slot.genderMode === 'shared' ? ['shared'] : wanted;

    const width = input.reference ? 1024 : slot.width;
    const height = input.reference ? 1536 : slot.height;
    const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait';

    const prompts = versions.map(version => {
      const g = version === 'shared' ? 'male' : version;
      const vars = {
        slot_label: slot.label,
        name,
        style,
        gender_label: GENDER_LABEL[version],
        subject: slot.subject,
        details: String(input.details || '').trim(),
        styleGuide: cfg.styleGuide,
        composition: slot.composition,
        genderNote: version === 'shared' ? '' : slot[g],
        width, height, orientation,
        background: input.chroma ? cfg.backgroundChroma : cfg.backgroundTransparent,
        technical: cfg.technical,
        negative: cfg.negative,
        reference: input.reference ? cfg.referenceBlock : '',
      };
      if (input.reference) {
        // A reference-aligned layer is always drawn on the avatar's own canvas.
        vars.composition = [
          '- Place the item exactly where it is worn on the reference character (' + slot.label + ' slot); keep natural proportions for that body.',
          '- The item must fit the character\'s body: it should visibly cover the area it protects (e.g. a chest armor spans the whole torso and shoulders).',
        ].join('\n');
      }
      const filePath = version === 'shared'
        ? `public/items/${file}_male.png  (e a mesma imagem como ${file}_female.png)  — ou 1 arquivo único: public/img/${file}.png`
        : `public/items/${file}_${version}.png`;
      return {
        version,
        title: version === 'shared' ? `${name} — imagem única` : `${name} — ${version === 'male' ? 'masculino' : 'feminino'}`,
        width, height,
        file: filePath,
        text: render(cfg.main, vars) + `\n\nFILE NAME: ${filePath.split('  ')[0]}`,
      };
    });

    const notes = [];
    if (versions.length === 2) notes.push('Gere o masculino primeiro e use-o como referência de estilo ao gerar o feminino (mesmo design, cores e materiais).');
    if (slot.genderMode === 'shared') notes.push('Este slot usa o mesmo desenho para todos os personagens. Salve a imagem uma vez e copie para _male e _female (ou use "Imagem única" ao adicionar).');
    if (input.reference) notes.push('Anexe a imagem do avatar como referência no gerador e, ao adicionar o item no studio, marque "Já desenhado no canvas do avatar".');
    else notes.push('Sprite solto: o studio mede a caixa visível e encaixa sozinho no corpo — não precisa se preocupar com a posição.');
    if (input.chroma) notes.push('Remova o fundo magenta (#FF00FF) antes de salvar — o PNG final precisa ter transparência real.');
    notes.push(`Tamanho esperado: ${width} × ${height}px. Se o gerador entregar outro tamanho, redimensione sem distorcer (os PNGs atuais do jogo seguem essas proporções).`);
    return { errors: [], prompts, notes };
  }

  return { slugify, titleCase, render, build };
});
