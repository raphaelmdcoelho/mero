// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

// Item image map: item_id → base path (gender suffix + .png appended at runtime)
const ITEM_IMAGES = {
  3:  '/items/leather_armor',    // Leather Armor
  4:  '/items/iron_shield',      // Iron Shield
  12: '/items/oak_shield',       // Oak Shield
  15: '/items/hunter_armor',     // Hunter Armor
  31: '/items/iron_gauntlets',   // Iron Gauntlets
  33: '/items/boot_leather',     // Leather Boots
};

const ITEM_IMAGES_STATIC = {
  6:  '/img/carrot_icon.png',      // Carrot
  7:  '/img/apple_icon.png',       // Apple
  29: '/img/onion_icon.png',       // Onion
  30: '/img/corn.png',             // Corn
  35: '/img/leather_helmet.png',   // Leather Helmet
};

function getItemImage(itemId, gender) {
  const id = Number(itemId);
  if (ITEM_IMAGES_STATIC[id]) return ITEM_IMAGES_STATIC[id];
  const base = ITEM_IMAGES[id];
  if (!base) return null;
  return `${base}_${gender || 'male'}.png`;
}

// Per-item overlay size overrides (percentage of avatar container)
const ITEM_OVERLAY_SIZE = {
  15: '50%', // Hunter Armor — slightly smaller on avatar
};

function itemIconHtml(itemId, itemIcon, itemName, gender, imgClass) {
  const img = getItemImage(itemId, gender);
  if (img) return `<img class="${imgClass}" src="${img}" alt="${escHtml(itemName)}" />`;
  return itemIcon || '?';
}

const ATTRS = [
  { key: 'strength',      labelKey: 'attr.strength',      hintKey: 'attr.strength_hint' },
  { key: 'dexterity',     labelKey: 'attr.dexterity',     hintKey: 'attr.dexterity_hint' },
  { key: 'agility',       labelKey: 'attr.agility',       hintKey: 'attr.agility_hint' },
  { key: 'vitality',      labelKey: 'attr.vitality',      hintKey: 'attr.vitality_hint' },
  { key: 'intelligence',  labelKey: 'attr.intelligence',  hintKey: 'attr.intelligence_hint' },
  { key: 'focus',         labelKey: 'attr.focus',         hintKey: 'attr.focus_hint' },
  { key: 'stamina',       labelKey: 'attr.stamina',       hintKey: 'attr.stamina_hint' },
  { key: 'resistance',    labelKey: 'attr.resistance',    hintKey: 'attr.resistance_hint' },
];

const DUNGEONS = [
  {
    id: 1,
    nameKey: 'dungeon.forest',
    name: 'Forest',
    icon: '/forest_icon_1.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 1,
    masteryCol: 'dungeon_mastery',
    unlockLevel: 1,
    xp: { easy: 55, medium: 90, hard: 130 },
  },
  {
    id: 6,
    nameKey: 'dungeon.autumn_harvest',
    name: 'Autumn Harvest',
    icon: '/autum_icon_2.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 6,
    masteryCol: 'dungeon_mastery_s6',
    unlockLevel: 5,
    xp: { easy: 83, medium: 135, hard: 195 },
  },
  {
    id: 7,
    nameKey: 'dungeon.murky_swamp',
    name: 'Murky Swamp',
    icon: '/swamp_icon_3.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 7,
    masteryCol: 'dungeon_mastery_s7',
    unlockLevel: 10,
    xp: { easy: 138, medium: 225, hard: 325 },
  },
  {
    id: 8,
    nameKey: 'dungeon.crystal_cave',
    name: 'Crystal Cave',
    icon: '/crystal_cave_icon_4.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 8,
    masteryCol: 'dungeon_mastery_s8',
    unlockLevel: 15,
    xp: { easy: 200, medium: 325, hard: 475 },
  },
];

// Alias used in renderBattlePanel
const DUNGEON_SETS = DUNGEONS;

const DIFFICULTY_COSTS     = { easy: 2, medium: 4, hard: 7 };
const DIFFICULTY_DURATIONS = { easy: 2 * 60 * 1000, medium: 3 * 60 * 1000, hard: 5 * 60 * 1000 };
// Difficulty maps directly to dungeon level (easy=1, medium=2, hard=3)
const DIFFICULTY_LEVEL     = { easy: 1, medium: 2, hard: 3 };

let currentDungeonIndex = 0;

let charState  = null;
let tickInterval = null;
let pendingAttrs = {};
let lastGearStats = null;
let selectedDungeonLevel = 1;
let selectedDungeonSet   = 1;
let selectedDifficulty   = 'easy';
let selectedPotionItemId = null;

// Dungeon countdown state (client-side)
let dungeonPollInterval = null;
let dungeonEndsAt       = null; // ms timestamp

// Tavern rest progress state (client-side)
let tavernStartedAt = null; // ms timestamp

// ---- Init ----
async function init() {
  const res = await api.get(`/api/game/${charId}/tick`);
  if (!res) return;
  const data = await res.json();
  charState = data;
  renderAll(data);
  startTick();
  // Resume dungeon polling if a run is already active
  if (data.activity === 'dungeon' && data.dungeonRun) {
    dungeonEndsAt = Number(data.dungeonRun.ends_at) * 1000;
    startDungeonPoll();
    openPanel('battle');
  }
  // Resume solo dungeon battle if one is in progress
  if (data.activity === 'dungeon_solo' && data.soloBattle) {
    resumeSoloBattle(data.soloBattle, data);
  }
  // Resume tavern progress bar if resting
  if (data.activity === 'tavern' && data.activity_started_at) {
    tavernStartedAt = Number(data.activity_started_at) * 1000;
    startLocalTimer();
  }
  // Resume read progress bar if reading
  if (data.activity === 'reading' && data.activity_started_at) {
    readStartedAt = Number(data.activity_started_at) * 1000;
    startLocalTimer();
  }
  // Resume farm timer if plants are growing
  if (data.farmQueue && data.farmQueue.length > 0) {
    const maxReadyAt = Math.max(...data.farmQueue.map(j => Number(j.ready_at)));
    farmEndsAt  = maxReadyAt * 1000;
    farmTotalMs = Number(localStorage.getItem('farmTotalMs')) || null;
    // Fallback: if no stored total, estimate from endsAt vs now (progress will start at current %)
    if (!farmTotalMs || farmTotalMs <= 0) farmTotalMs = farmEndsAt - Date.now();
    startFarmLocalTimer();
    startFarmPoll();
  }
}

// ---- Tick (tavern HP regen + farm harvest + stamina regen) ----
function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 5000);
}

async function tick() {
  const res = await api.get(`/api/game/${charId}/tick`);
  if (!res) return;
  const data = await res.json();
  charState = data;
  renderAll(data);
  if (data.fallen) showToast(t('game.js.hero_fallen'), 'danger');
  if (data.plantConsumed) {
    const icon = data.plantConsumed === 'carrot' ? '🥕' : '🍎';
    showToast(t('game.js.plant_consumed', { icon, plant: data.plantConsumed }), 'warn');
  }
  if (data.readingFinished) showToast(t('game.js.reading_done'), 'success');
}

// ---- Render ----
function renderAll(char) {
  document.getElementById('char-name-header').textContent = char.name || '';
  document.getElementById('char-class-header').textContent =
    `${CLASS_ICONS[char.class] || ''} ${char.class || ''} · ${t('game.js.level', { n: char.level })}`;

  renderCharAvatar(document.getElementById('avatar-display'), char);

  const xpPct = char.xp_to_next > 0 ? Math.min(100, (char.xp / char.xp_to_next) * 100) : 100;
  document.getElementById('xp-fill').style.width = xpPct + '%';
  document.getElementById('xp-text').textContent = `${Math.floor(char.xp)} / ${char.xp_to_next}`;

  // HP bar
  const hp    = Math.max(0, Number(char.hp) || 0);
  const maxHp = Number(char.max_hp) || 20;
  const hpPct = maxHp > 0 ? Math.min(100, (hp / maxHp) * 100) : 0;
  const hpFill = document.getElementById('hp-fill');
  if (hpFill) {
    hpFill.style.width = hpPct + '%';
    hpFill.classList.toggle('low', hpPct < 30);
  }
  const hpText = document.getElementById('hp-text');
  if (hpText) hpText.textContent = `${Math.ceil(hp)} / ${maxHp}`;

  // Stamina bar
  const st    = Math.max(0, Number(char.stamina) || 0);
  const maxSt = Number(char.max_stamina) || 10;
  const stPct = maxSt > 0 ? Math.min(100, (st / maxSt) * 100) : 0;
  document.getElementById('stamina-fill').style.width = stPct + '%';
  document.getElementById('stamina-text').textContent = `${Math.floor(st)} / ${maxSt}`;

  document.getElementById('level-display').textContent = t('game.js.level', { n: char.level });

  const unspent = Number(char.unspent_points) || 0;
  const badge   = document.getElementById('unspent-badge');
  const headerNotice = document.getElementById('unspent-header');
  if (unspent > 0) {
    badge.textContent = unspent;
    badge.style.display = 'flex';
    headerNotice.textContent = unspent === 1
      ? t('game.js.points_spend_one',  { n: unspent })
      : t('game.js.points_spend_many', { n: unspent });
    headerNotice.style.display = 'inline';
  } else {
    badge.style.display = 'none';
    headerNotice.style.display = 'none';
  }

  const actBadge = document.getElementById('activity-badge');
  const actLabel = document.getElementById('activity-label');
  if (char.activity) {
    actBadge.style.display = 'inline-flex';
    if (char.activity === 'dungeon') {
      const run = char.dungeonRun;
      const lvl = run ? run.dungeon_level : '';
      actLabel.textContent = t('game.js.dungeon_badge', { n: lvl });
    } else if (char.activity === 'dungeon_solo') {
      const sb = char.soloBattle;
      actLabel.textContent = sb ? `⚔️ Fighting ${sb.monster_name}` : '⚔️ Dungeon';
    } else if (char.activity === 'farm') {
      actLabel.textContent = t('game.js.farming_badge');
    } else if (char.activity === 'reading') {
      const elapsed = Math.floor(Date.now() / 1000) - (char.activity_started_at || 0);
      const minsLeft = Math.max(0, Math.ceil((3600 - elapsed) / 60));
      actLabel.textContent = t('game.js.reading_badge', { mins: minsLeft });
    } else {
      actLabel.textContent = t('game.js.resting_badge');
    }
  } else {
    actBadge.style.display = 'none';
  }

  // Sync read progress bar state with server activity
  if (char.activity === 'reading' && char.activity_started_at && !readStartedAt) {
    readStartedAt = Number(char.activity_started_at) * 1000;
    startLocalTimer();
  } else if (char.activity !== 'reading' && readStartedAt) {
    readStartedAt = null;
    document.getElementById('sq-read')?.style.setProperty('--read-progress', '0%');
  }

  updateActionSquares(char.activity, char.farmQueue && char.farmQueue.length > 0);

  const farmLock = document.getElementById('farm-lock-badge');
  const level = Number(char.level) || 1;
  const farmBlockedByActivity = ['tavern', 'dungeon', 'reading'].includes(char.activity) || (char.farmQueue && char.farmQueue.length > 0);
  if (level < 3) {
    farmLock.style.display = 'flex';
    document.getElementById('sq-farm').classList.add('disabled');
  } else {
    farmLock.style.display = 'none';
    if (!farmBlockedByActivity) document.getElementById('sq-farm').classList.remove('disabled');
  }
  // Farm progress bar — resume if growing
  if (!farmEndsAt && char.farmQueue && char.farmQueue.length > 0) {
    const maxReadyAt = Math.max(...char.farmQueue.map(j => Number(j.ready_at)));
    farmEndsAt  = maxReadyAt * 1000;
    farmTotalMs = Number(localStorage.getItem('farmTotalMs')) || null;
    if (!farmTotalMs || farmTotalMs <= 0) farmTotalMs = farmEndsAt - Date.now();
    startFarmLocalTimer();
    startFarmPoll();
  }
  updateFarmTimerBadge();

  const gold = Number(char.gold) || 0;
  document.getElementById('gold-display').textContent = `🪙 ${gold}g`;

  renderInventory(char);
  renderEquipment(char);
  renderAttributes(char);
  renderBattlePanel(char);
  renderMarketPanel(char);
  refreshCombatStats();
}

// Shared avatar renderer — used by the game screen and the equipment modal
function renderCharAvatar(containerEl, char) {
  if (!containerEl || !char) return;
  const armorImg    = char.equippedArmor  ? getItemImage(char.equippedArmor.id,  char.gender) : null;
  const shieldImg   = char.equippedShield ? getItemImage(char.equippedShield.id, char.gender) : null;
  const bootsImg    = char.equippedBoots  ? getItemImage(char.equippedBoots.id,  char.gender) : null;
  const gauntletImg = char.equippedArm    ? getItemImage(char.equippedArm.id,    char.gender) : null;
  const helmetImg   = char.equippedHelmet ? getItemImage(char.equippedHelmet.id, char.gender) : null;
  let armorOverlay = '';
  if (armorImg) {
    const size = ITEM_OVERLAY_SIZE[Number(char.equippedArmor.id)];
    const style = size ? ` style="width:${size};height:${size}"` : '';
    const armorGenderClass = char.gender === 'female' ? ' equip-overlay-armor--female' : '';
    armorOverlay = `<img class="equip-overlay${armorGenderClass}"${style} src="${escHtml(armorImg)}" alt="" />`;
  }
  const shieldOverlay   = shieldImg   ? `<img class="equip-overlay equip-overlay-shield"   src="${escHtml(shieldImg)}"   alt="" />` : '';
  const bootsGenderClass = char.gender === 'female' ? ' equip-overlay-boots--female' : '';
  const bootsOverlay    = bootsImg    ? `<img class="equip-overlay equip-overlay-boots${bootsGenderClass}" src="${escHtml(bootsImg)}" alt="" />` : '';
  const gauntletOverlay = gauntletImg ? `<img class="equip-overlay equip-overlay-gauntlet" src="${escHtml(gauntletImg)}" alt="" />` : '';
  const helmetOverlay   = helmetImg   ? `<img class="equip-overlay equip-overlay-helmet"   src="${escHtml(helmetImg)}"   alt="" />` : '';
  if (char.avatar_path) {
    containerEl.innerHTML = `<img class="char-avatar-img" src="${escHtml(char.avatar_path)}" alt="Avatar" />${armorOverlay}${shieldOverlay}${bootsOverlay}${gauntletOverlay}${helmetOverlay}`;
  } else {
    const icon = CLASS_ICONS[char.class] || '🧍';
    containerEl.innerHTML = `<span class="char-avatar-icon">${icon}</span>${armorOverlay}${shieldOverlay}${bootsOverlay}${gauntletOverlay}${helmetOverlay}`;
  }
}

function updateActionSquares(activity, isFarming = false) {
  const dungeon     = document.getElementById('sq-dungeon');
  const soloDungeon = document.getElementById('sq-solo-dungeon');
  const farm        = document.getElementById('sq-farm');
  const tavern      = document.getElementById('sq-tavern');
  const inv         = document.getElementById('sq-inventory');
  const eq          = document.getElementById('sq-equipment');
  const attrs       = document.getElementById('sq-attributes');
  const stats       = document.getElementById('sq-stats');
  const read        = document.getElementById('sq-read');
  const fishing     = document.getElementById('sq-fishing');

  const resetEls = [dungeon, soloDungeon, farm, tavern, inv, eq, attrs, stats, read, fishing].filter(Boolean);
  resetEls.forEach(el => el.classList.remove('active', 'disabled'));


  document.getElementById('dungeon-label').textContent = t('game.js.dungeon_lbl');
  document.getElementById('tavern-label').textContent  = t('game.js.tavern_lbl');
  document.getElementById('farm-label').textContent    = t('game.js.farm_lbl');
  if (read) document.getElementById('read-label').textContent = t('game.js.read_lbl');

  if (isFarming) {
    dungeon.classList.add('disabled');
    if (soloDungeon) soloDungeon.classList.add('disabled');
    tavern.classList.add('disabled');
    if (read) read.classList.add('disabled');
    if (fishing) fishing.classList.add('disabled');
  } else if (activity === 'dungeon') {
    dungeon.classList.add('active');
    if (soloDungeon) soloDungeon.classList.add('disabled');
    tavern.classList.add('disabled');
    farm.classList.add('disabled');
    if (read) read.classList.add('disabled');
    if (fishing) fishing.classList.add('disabled');
  } else if (activity === 'dungeon_solo') {
    if (soloDungeon) soloDungeon.classList.add('active');
    dungeon.classList.add('disabled');
    tavern.classList.add('disabled');
    farm.classList.add('disabled');
    if (read) read.classList.add('disabled');
    if (fishing) fishing.classList.add('disabled');
  } else if (activity === 'tavern') {
    tavern.classList.add('active');
    document.getElementById('tavern-label').textContent = t('game.js.stop_lbl');
    dungeon.classList.add('disabled');
    farm.classList.add('disabled');
    if (read) read.classList.add('disabled');
    if (fishing) fishing.classList.add('disabled');
  } else if (activity === 'reading') {
    if (read) {
      read.classList.add('active');
      document.getElementById('read-label').textContent = t('game.js.stop_lbl');
    }
    dungeon.classList.add('disabled');
    tavern.classList.add('disabled');
    farm.classList.add('disabled');
    if (fishing) fishing.classList.add('disabled');
  }

  const pickaxe = document.getElementById('pickaxe-wrap');
  if (pickaxe) pickaxe.classList.toggle('mining', !!activity || isFarming);
}

// ---- Action handlers ----
function handleDungeon() {
  if (!charState) return;
  if (farmEndsAt) return;
  if (charState.activity === 'dungeon') {
    openPanel('battle');
    return;
  }
  if (charState.activity) return;
  openDungeonModal();
}

function handleTavern() {
  if (!charState) return;
  if (farmEndsAt) return;
  if (charState.activity === 'tavern') { stopActivity(); return; }
  if (!charState.activity) openTavernModal();
}

let selectedRestType = null;

function openTavernModal() {
  selectedRestType = null;
  const gold = Number(charState?.gold) || 0;
  const REST_TYPES = [
    { key: 'relax',    cost: 10, nameKey: 'tavern.rest.relax',    descKey: 'tavern.rest.relax_desc' },
    { key: 'break',    cost: 30, nameKey: 'tavern.rest.break',    descKey: 'tavern.rest.break_desc' },
    { key: 'recovery', cost: 70, nameKey: 'tavern.rest.recovery', descKey: 'tavern.rest.recovery_desc' },
  ];
  const container = document.getElementById('tavern-rest-options');
  container.innerHTML = REST_TYPES.map(r => {
    const canAfford = gold >= r.cost;
    return `<div class="tavern-rest-card${canAfford ? '' : ' disabled'}" data-rest-key="${r.key}"
                 ${canAfford ? `onclick="selectTavernRest('${r.key}')"` : ''}>
      <div class="tavern-rest-card-info">
        <span class="tavern-rest-card-name">${t(r.nameKey)}</span>
        <span class="tavern-rest-card-desc">${t(r.descKey)}</span>
      </div>
      <span class="tavern-rest-card-cost">🪙 ${r.cost}g</span>
    </div>`;
  }).join('');
  document.getElementById('tavern-start-btn').disabled = true;
  document.getElementById('tavern-modal').classList.add('open');
}

function selectTavernRest(key) {
  selectedRestType = key;
  document.querySelectorAll('.tavern-rest-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.restKey === key);
  });
  document.getElementById('tavern-start-btn').disabled = false;
}

function confirmTavernRest() {
  if (!selectedRestType) return;
  startTavernRest(selectedRestType);
}

function closeTavernModal() {
  selectedRestType = null;
  document.getElementById('tavern-modal').classList.remove('open');
}

async function startTavernRest(restType) {
  closeTavernModal();
  const res = await api.post(`/api/game/${charId}/start`, { action: 'tavern', restType });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed'), 'danger'); return; }
  charState = data;
  tavernStartedAt = Date.now();
  startLocalTimer();
  renderAll(data);
  document.getElementById('gold-display').textContent = `🪙 ${Number(data.gold) || 0}g`;
  const COST_LABELS = { relax: '10g', break: '30g', recovery: '70g' };
  showToast(`${t('game.js.resting_start')} (−${COST_LABELS[restType]})`, 'success');
}

async function stopActivity() {
  const res = await api.post(`/api/game/${charId}/stop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_stop'), 'danger'); return; }
  tavernStartedAt = null;
  readStartedAt   = null;
  document.getElementById('sq-tavern')?.style.setProperty('--tavern-progress', '0%');
  document.getElementById('sq-read')?.style.setProperty('--read-progress', '0%');
  if (!dungeonEndsAt) stopLocalTimer();
  charState = data;
  renderAll(data);
  showToast(t('game.js.activity_stopped'), '');
}

// ---- Dungeon carousel modal ----
function openDungeonModal() {
  selectedDifficulty   = 'easy';
  selectedDungeonLevel = DIFFICULTY_LEVEL.easy;
  selectedPotionItemId = null;
  renderDungeonCarousel();
  updateDifficultyUI();
  renderPotionSelector();
  document.getElementById('dungeon-modal').classList.add('open');
}

const POTION_BUFF_LABELS = {
  speed:          '⚡ −30% dungeon time',
  loot_quality:   '🍀 Improved loot quality',
  loot_count:     '🎁 +2 extra loot items',
  stamina:        '💚 +1 stamina on completion',
  xp_multiplier:  '📚 ×2 XP gain',
};

function tItemName(item) {
  const key = `item.name.${item.item_id || item.id}`;
  const val = t(key);
  return val !== key ? val : item.name;
}

function tItemDesc(item) {
  const key = `item.desc.${item.item_id || item.id}`;
  const val = t(key);
  return val !== key ? val : (item.description || '');
}

function tItemType(item) {
  const typeStr = t(`item.type.${item.type}`) || item.type;
  const wtypeStr = item.weapon_type ? t(`item.wtype.${item.weapon_type}`) || item.weapon_type : null;
  const slotStr  = item.armor_slot  ? t(`item.slot.${item.armor_slot}`)  || item.armor_slot  : null;
  return typeStr + (wtypeStr ? ' · ' + wtypeStr : '') + (slotStr ? ' · ' + slotStr : '');
}

function tDungeonName(dungeon) {
  return t(dungeon.nameKey) || dungeon.name;
}

function renderPotionSelector() {
  const section = document.getElementById('dungeon-potion-section');
  const list    = document.getElementById('potion-slot-list');
  if (!charState) { section.style.display = 'none'; return; }

  const potions = (charState.inventory || []).filter(i => i.item_subtype === 'adventure_potion');
  section.style.display = '';
  if (!potions.length) {
    list.innerHTML = `<p class="potion-empty-msg">${t('dungeon.no_potions')}</p>`;
    return;
  }

  const noneSelected = selectedPotionItemId === null;
  list.innerHTML = [
    `<button type="button" class="potion-slot${noneSelected ? ' selected' : ''}" onclick="selectPotion(null)">
       <span class="potion-slot-icon">✗</span>
       <span class="potion-slot-name">${t('dungeon.none')}</span>
     </button>`,
    ...potions.map(p => {
      let buffLabel = '';
      try {
        const b = JSON.parse(p.buff_effect || '{}');
        buffLabel = POTION_BUFF_LABELS[b.type] || '';
      } catch {}
      const sel = selectedPotionItemId === p.item_id;
      return `<button type="button" class="potion-slot${sel ? ' selected' : ''}" onclick="selectPotion(${p.item_id})">
        <span class="potion-slot-icon">${p.icon}</span>
        <span class="potion-slot-name">${escHtml(tItemName(p))}</span>
        ${p.quantity > 1 ? `<span class="potion-slot-qty">×${p.quantity}</span>` : ''}
        ${buffLabel ? `<span class="potion-slot-buff">${buffLabel}</span>` : ''}
      </button>`;
    }),
  ].join('');
}

function selectPotion(itemId) {
  selectedPotionItemId = itemId;
  renderPotionSelector();
}

function fmtXp(n) {
  return n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k XP' : n + ' XP';
}

function renderDungeonCarousel() {
  const dungeon = DUNGEONS[currentDungeonIndex];
  selectedDungeonSet = dungeon.set;

  const content = document.getElementById('dungeon-carousel-content');
  const displayName = tDungeonName(dungeon);
  content.innerHTML = `
    <img class="dungeon-icon-img" src="${dungeon.icon}" alt="${escHtml(displayName)}"
         onerror="this.onerror=null;this.src='${dungeon.fallbackIcon}'">
    <div class="dungeon-carousel-name">${escHtml(displayName)}</div>
  `;

  document.getElementById('carousel-prev').disabled = currentDungeonIndex === 0;
  document.getElementById('carousel-next').disabled = currentDungeonIndex === DUNGEONS.length - 1;

  const xp = dungeon.xp || {};
  ['easy', 'medium', 'hard'].forEach(d => {
    const el = document.getElementById(`diff-xp-${d}`);
    if (el) el.textContent = xp[d] != null ? fmtXp(xp[d]) : '';
  });
}

function selectDifficulty(diff) {
  selectedDifficulty   = diff;
  selectedDungeonLevel = DIFFICULTY_LEVEL[diff] || 1;
  updateDifficultyUI();
}

function updateDifficultyUI() {
  ['easy', 'medium', 'hard'].forEach(d => {
    document.getElementById(`diff-${d}`).classList.toggle('selected', d === selectedDifficulty);
  });

  const dungeon    = DUNGEONS[currentDungeonIndex];
  const heroLevel  = charState ? (Number(charState.level) || 1) : 1;
  const cost       = DIFFICULTY_COSTS[selectedDifficulty] || 2;
  const stamina    = charState ? (Number(charState.stamina) || 0) : 0;
  const warn       = document.getElementById('stamina-warning');
  const enterBtn   = document.getElementById('enter-dungeon-btn');

  if (heroLevel < dungeon.unlockLevel) {
    warn.textContent = t('dungeon.requires_level', { n: dungeon.unlockLevel, lvl: heroLevel });
    warn.classList.remove('hidden');
    enterBtn.disabled = true;
  } else if (stamina < cost) {
    warn.textContent = t('dungeon.no_stamina', { need: cost, have: stamina });
    warn.classList.remove('hidden');
    enterBtn.disabled = true;
  } else {
    warn.classList.add('hidden');
    enterBtn.disabled = false;
  }
}

function prevDungeon() {
  if (currentDungeonIndex > 0) {
    currentDungeonIndex--;
    selectedDungeonLevel = 1;
    renderDungeonCarousel();
    updateDifficultyUI();
  }
}

function nextDungeon() {
  if (currentDungeonIndex < DUNGEONS.length - 1) {
    currentDungeonIndex++;
    selectedDungeonLevel = 1;
    renderDungeonCarousel();
    updateDifficultyUI();
  }
}

function closeDungeonModal() {
  selectedPotionItemId = null;
  document.getElementById('dungeon-modal').classList.remove('open');
}

async function confirmEnterDungeon() {
  closeDungeonModal();
  const body = {
    level: selectedDungeonLevel,
    set: selectedDungeonSet,
    difficulty: selectedDifficulty,
  };
  if (selectedPotionItemId) body.potion_item_id = selectedPotionItemId;
  const res = await api.post(`/api/game/${charId}/dungeon/enter`, body);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_dungeon'), 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast(t('game.js.entered_dungeon', { n: selectedDungeonLevel }), 'success');

  if (data.dungeonRun) {
    dungeonEndsAt = Number(data.dungeonRun.ends_at) * 1000;
    startDungeonPoll();
  }
  openPanel('battle');
}

document.getElementById('dungeon-modal').addEventListener('click', function(e) {
  if (e.target === this) closeDungeonModal();
});

document.getElementById('tavern-modal').addEventListener('click', function(e) {
  if (e.target === this) closeTavernModal();
});

// ---- Battle panel (timer-based) ----
function renderBattlePanel(char) {
  if (!char || !char.dungeonRun) return;
  const run = char.dungeonRun;

  const dungeonInfo = DUNGEONS.find(d => d.set === (Number(run.dungeon_set) || 1)) || DUNGEONS[0];
  const dName = tDungeonName(dungeonInfo);
  document.getElementById('battle-title').textContent = `⚔️ ${dName} · Lv ${run.dungeon_level}`;
  document.getElementById('dungeon-run-label').textContent = `${dName} · Lv ${run.dungeon_level}`;

  const diff = run.difficulty || 'easy';
  document.getElementById('dungeon-diff-badge').textContent = t(`dungeon.diff.${diff}`);

  // Show active potion badge
  const potionRow = document.getElementById('active-potion-row');
  const activePotionId = run.potion_item_id ? Number(run.potion_item_id) : null;
  if (activePotionId) {
    const potionItem = (char.inventory || []).find(i => i.item_id === activePotionId);
    let buffLabel = '';
    try {
      const b = JSON.parse(potionItem?.buff_effect || '{}');
      buffLabel = POTION_BUFF_LABELS[b.type] || '';
    } catch {}
    potionRow.innerHTML = `<span class="active-potion-badge">${potionItem?.icon || '🧪'} ${escHtml(potionItem?.name || 'Potion')} · ${buffLabel}</span>`;
    potionRow.classList.remove('hidden');
  } else {
    potionRow.classList.add('hidden');
  }

  // Update countdown display immediately from local state
  if (dungeonEndsAt) updateTimerDisplay();
}

function updateTimerDisplay() {
  const nowMs       = Date.now();
  const remainingMs = Math.max(0, (dungeonEndsAt || nowMs) - nowMs);
  const totalMs     = DIFFICULTY_DURATIONS[charState?.dungeonRun?.difficulty] || DIFFICULTY_DURATIONS.easy;

  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  document.getElementById('dungeon-timer-display').textContent =
    `${mins}:${String(secs).padStart(2, '0')}`;

  const pct = totalMs > 0 ? Math.min(100, (remainingMs / totalMs) * 100) : 0;
  document.getElementById('dungeon-timer-fill').style.width = pct + '%';
}

// Local 1-second timer update (purely cosmetic — server is authoritative)
let localTimerInterval = null;

function updateTavernProgressBar() {
  const btn = document.getElementById('sq-tavern');
  if (!btn) return;
  if (!tavernStartedAt) { btn.style.setProperty('--tavern-progress', '0%'); return; }
  const elapsedSec = (Date.now() - tavernStartedAt) / 1000;
  btn.style.setProperty('--tavern-progress', Math.min(100, (elapsedSec / 300) * 100) + '%');
}

function updateDungeonButtonFill() {
  const btn = document.getElementById('sq-dungeon');
  if (!btn) return;
  if (!dungeonEndsAt) { btn.style.setProperty('--dungeon-progress', '0%'); return; }
  const totalMs     = DIFFICULTY_DURATIONS[charState?.dungeonRun?.difficulty] || DIFFICULTY_DURATIONS.easy;
  const remainingMs = Math.max(0, dungeonEndsAt - Date.now());
  const pct         = totalMs > 0 ? Math.min(100, ((totalMs - remainingMs) / totalMs) * 100).toFixed(1) : 0;
  btn.style.setProperty('--dungeon-progress', pct + '%');
}

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (dungeonEndsAt) updateTimerDisplay();
    updateTavernProgressBar();
    updateReadProgressBar();
    updateDungeonButtonFill();
  }, 1000);
}

function stopLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = null;
}

// Poll the server every 5 s; complete the run when timer hits 0
function startDungeonPoll() {
  if (dungeonPollInterval) clearInterval(dungeonPollInterval);
  startLocalTimer();
  dungeonPollInterval = setInterval(pollDungeonStatus, 5000);
}

function stopDungeonPoll() {
  if (dungeonPollInterval) clearInterval(dungeonPollInterval);
  dungeonPollInterval = null;
  stopLocalTimer();
  dungeonEndsAt = null;
  updateDungeonButtonFill();
}

async function pollDungeonStatus() {
  const res = await api.get(`/api/game/${charId}/dungeon/status`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) return;

  if (!data.active && data.done) {
    stopDungeonPoll();
    charState = data.char;
    renderAll(data.char);
    closePanel('battle');
    showLootModal(data, false);
    return;
  }


  if (data.active) {
    dungeonEndsAt = Number(data.endsAt) * 1000;
    updateTimerDisplay();
  }
}

async function stopDungeon() {
  stopDungeonPoll();
  const res = await api.post(`/api/game/${charId}/dungeon/stop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed', 'danger'); return; }
  charState = data.char;
  renderAll(data.char);
  closePanel('battle');
  showLootModal(data, true);
}

// ---- Loot Modal ----
function showLootModal(data, forced) {
  const modal = document.getElementById('loot-modal');
  document.getElementById('loot-modal-title').textContent =
    forced ? t('dungeon.stopped') : t('dungeon.complete');

  const xpRow = document.getElementById('loot-xp-row');
  xpRow.textContent = data.gainedXp ? `+${data.gainedXp} XP` : '';

  const goldRow = document.getElementById('loot-gold-row');
  goldRow.textContent = data.gainedGold ? `🪙 +${data.gainedGold}g` : '';

  // Show potion buff that was applied
  const buffRow = document.getElementById('loot-buff-row');
  if (data.buff && data.buff.type) {
    const label = POTION_BUFF_LABELS[data.buff.type] || '';
    buffRow.textContent = label ? `✨ ${label} applied` : '';
    buffRow.classList.toggle('hidden', !label);
  } else {
    buffRow.classList.add('hidden');
  }

  const lootList = document.getElementById('loot-list');
  const loot = data.loot || [];
  if (loot.length === 0) {
    lootList.innerHTML = `<div class="loot-item-row"><span style="color:var(--muted);font-size:0.85rem;">${t('dungeon.no_loot')}</span></div>`;
  } else {
    lootList.innerHTML = loot.map(item =>
      `<div class="loot-item-row">
        <span class="loot-item-icon">${itemIconHtml(item.item_id, item.icon, tItemName(item), null, 'loot-item-icon-img')}</span>
        <span class="loot-item-name">${escHtml(tItemName(item))}</span>
        <span class="loot-item-qty">×${item.quantity}</span>
      </div>`
    ).join('');
  }


  modal.classList.add('open');
}

function closeLootModal() {
  document.getElementById('loot-modal').classList.remove('open');
  renderAll(charState);
}

document.getElementById('loot-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLootModal();
});

// ---- Combat Stats ----
async function refreshCombatStats() {
  const panel = document.getElementById('attr-modal');
  if (!panel.classList.contains('open')) return;

  const res = await api.get(`/api/game/${charId}/stats`);
  if (!res || !res.ok) return;
  const s = await res.json();
  lastGearStats = s;
  renderCombatStats(s, null);
}

function calcLocalStats(char, pending, gear) {
  const level = Number(char.level) || 1;
  const str = (Number(char.attr_strength)     || 5) + (pending.strength     || 0);
  const dex = (Number(char.attr_dexterity)    || 5) + (pending.dexterity    || 0);
  const agi = (Number(char.attr_agility)      || 5) + (pending.agility      || 0);
  const vit = (Number(char.attr_vitality)     || 5) + (pending.vitality     || 0);
  const res = (Number(char.attr_resistance)   || 5) + (pending.resistance   || 0);
  return {
    maxHp:       10 + (level - 1) * 5 + vit * 2,
    damage:      Math.max(1, 1 + Math.floor((gear.isRanged ? dex : str) / 3) + (gear.weaponDmg || 0)),
    hitChance:   Math.min(95, 60 + Math.floor(dex / 2)),
    dodgeChance: Math.min(50, Math.floor(agi / 2)),
    defense:     Math.floor(res / 3) + (gear.armorDef || 0) + (gear.shieldDef || 0),
    isRanged:    gear.isRanged,
  };
}

function renderCombatStats(current, projected) {
  function fmtStat(cur, proj, suffix = '') {
    if (proj === null || proj === undefined || proj === cur) return cur + suffix;
    const diff = proj - cur;
    const cls  = diff > 0 ? 'pos' : 'neg';
    const sign = diff > 0 ? '+' : '';
    return `${cur}${suffix} <span class="cstat-diff ${cls}">${sign}${diff}</span>`;
  }
  const typeLabel = (s) => s.isRanged ? t('game.js.ranged') : t('game.js.melee');
  document.getElementById('cstat-hp').innerHTML    = fmtStat(current.maxHp,       projected?.maxHp);
  document.getElementById('cstat-dmg').innerHTML   = fmtStat(current.damage,      projected?.damage, ' ' + typeLabel(current));
  document.getElementById('cstat-hit').innerHTML   = fmtStat(current.hitChance,   projected?.hitChance, '%');
  document.getElementById('cstat-dodge').innerHTML = fmtStat(current.dodgeChance, projected?.dodgeChance, '%');
  document.getElementById('cstat-def').innerHTML   = fmtStat(current.defense,     projected?.defense);
}

// ---- Side panels ----
const PANEL_MAP = {
  inventory:  'inv-panel',
  equipment:  'eq-panel',
  attributes: 'attr-modal',
  battle:     'battle-panel',
  market:     'market-panel',
};

function openPanel(type) {
  Object.values(PANEL_MAP).forEach(id => document.getElementById(id).classList.remove('open'));
  const panelId = PANEL_MAP[type];
  if (panelId) document.getElementById(panelId).classList.add('open');
  if (type === 'attributes') { pendingAttrs = {}; renderAttributes(charState); refreshCombatStats(); }
  if (type === 'equipment') renderEquipment(charState);
  if (type === 'farm')   renderFarmPanel();
  if (type === 'market') { switchMarketTab('sell'); renderMarketPanel(charState); }
  if (type === 'battle') {
    renderBattlePanel(charState);
    if (dungeonEndsAt) updateTimerDisplay();
  }
}

function eqOverlayClick(e) {
  if (e.target === document.getElementById('eq-panel')) closePanel('equipment');
}

function attrOverlayClick(e) {
  if (e.target === document.getElementById('attr-modal')) closePanel('attributes');
}

function invOverlayClick(e) {
  if (e.target === document.getElementById('inv-panel')) closePanel('inventory');
}

function closePanel(type) {
  const panelId = PANEL_MAP[type];
  if (panelId) document.getElementById(panelId).classList.remove('open');
}

function itemEquipSlot(item) {
  if (!item) return null;
  if (item.type === 'weapon') return 'weapon';
  if (item.type !== 'armor') return null;
  const s = item.armor_slot;
  if (s === 'shield') return 'shield';
  if (s === 'arm')    return 'arm';
  if (s === 'boots')  return 'boots';
  if (s === 'helmet') return 'helmet';
  return 'armor';
}

function equippedSlotMap(char) {
  return {
    weapon: char.weapon_id || null,
    armor:  char.armor_id  || null,
    shield: char.shield_id || null,
    arm:    char.arm_id    || null,
    boots:  char.boots_id  || null,
    helmet: char.helmet_id || null,
  };
}

const MAX_INVENTORY_SLOTS = 40;

// ---- Inventory ----
function renderInventory(char) {
  if (!char) return;
  const prevIdx = selectedInvIdx;
  const grid = document.getElementById('inv-grid');
  const inv  = char.inventory || [];
  const slots = Array(MAX_INVENTORY_SLOTS).fill(null);
  inv.forEach((item, i) => { if (i < MAX_INVENTORY_SLOTS) slots[i] = item; });
  const equippedIds = new Set([char.weapon_id, char.armor_id, char.shield_id].filter(Boolean));

  const gender = char.gender || 'male';
  grid.innerHTML = slots.map((item, i) => {
    if (!item) return `<div class="inv-slot empty" title="${t('game.js.empty')}">·</div>`;
    const isEq = equippedIds.has(item.item_id);
    const displayName = tItemName(item);
    return `<div class="inv-slot${isEq ? ' equipped' : ''}" onclick="showItemInfo(${i})" title="${escHtml(displayName)}">
      ${itemIconHtml(item.item_id, item.icon, displayName, gender, 'inv-item-img')}
      ${item.quantity > 1 ? `<span class="qty">${item.quantity}</span>` : ''}
    </div>`;
  }).join('');

  // restore selection if an item was open before the re-render
  if (prevIdx !== null && inv[prevIdx]) {
    selectedInvIdx = null; // reset so showItemInfo doesn't treat it as a toggle
    showItemInfo(prevIdx);
  }
}

function showItemInfo(idx) {
  if (!charState) return;
  const item = (charState.inventory || [])[idx];
  const tooltip = document.getElementById('item-tooltip');

  // toggle: clicking the same slot again dismisses
  if (selectedInvIdx === idx && tooltip.style.display !== 'none') {
    tooltip.style.display = 'none';
    selectedInvIdx = null;
    document.querySelectorAll('#inv-grid .inv-slot').forEach(s => s.classList.remove('selected'));
    return;
  }

  selectedInvIdx = idx;
  document.querySelectorAll('#inv-grid .inv-slot').forEach((s, i) => {
    s.classList.toggle('selected', i === idx);
  });

  if (!item) { tooltip.style.display = 'none'; return; }
  const statLine = item.damage  ? `⚔️ ${item.damage} ${t('game.js.dmg_unit')}`
                 : item.defense ? `🛡️ ${item.defense} ${t('game.js.def_unit')}`
                 : '';
  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <strong class="item-tt-name">${itemIconHtml(item.item_id || item.id, item.icon, '', charState?.gender, 'item-tt-icon-img')} ${escHtml(tItemName(item))}</strong>
    <span class="item-tt-type">${tItemType(item)}</span>
    <p class="item-tt-desc">${escHtml(tItemDesc(item))}${statLine ? ' ' + statLine : ''}</p>
    ${item.quantity > 1 ? `<div class="item-tt-qty">${t('game.js.qty')}: ${item.quantity}</div>` : ''}
    ${item.sell_price ? `<div class="item-tt-price">🪙 ${item.sell_price}g</div>` : ''}`;
}

// ---- Equipment Modal ----

function _eqFillSlot(slotName, item, defaultIcon) {
  const slotEl = document.getElementById(`eq-slot-${slotName}`);
  const iconEl = document.getElementById(`eq-doll-${slotName}-icon`);
  const nameEl = document.getElementById(`eq-doll-${slotName}-name`);
  const statEl = document.getElementById(`eq-doll-${slotName}-stat`);
  if (item) {
    iconEl.innerHTML = itemIconHtml(item.id, item.icon, tItemName(item), charState?.gender, 'eq-slot-icon-img');
    nameEl.textContent = tItemName(item);
    if (slotName === 'weapon' && item.damage) {
      statEl.textContent = `⚔️ ${item.damage} ${t('game.js.dmg_unit')}`;
    } else if (item.defense) {
      statEl.textContent = `🛡️ ${item.defense} ${t('game.js.def_unit')}`;
    } else {
      statEl.textContent = '';
    }
    slotEl.classList.add('has-item');
    slotEl.onclick = () => unequipItem(slotName);
    slotEl.title = t('game.js.unequip_btn');
  } else {
    iconEl.textContent = defaultIcon;
    nameEl.textContent = '—';
    statEl.textContent = '';
    slotEl.classList.remove('has-item');
    slotEl.onclick = null;
    slotEl.title = '';
  }
}

function renderEquipment(char) {
  if (!char) return;

  // Fill all five doll slots
  _eqFillSlot('weapon', char.equippedWeapon, '🗡️');
  _eqFillSlot('armor',  char.equippedArmor,  '🥋');
  _eqFillSlot('shield', char.equippedShield, '🛡️');
  _eqFillSlot('arm',    char.equippedArm,    '🥊');
  _eqFillSlot('boots',  char.equippedBoots,  '👢');
  _eqFillSlot('helmet', char.equippedHelmet, '🪖');

  // Avatar in the center — shared renderer, same as main game screen
  renderCharAvatar(document.getElementById('eq-doll-avatar'), char);

  // Inventory grid — equippable items only
  const equippedBySlot = equippedSlotMap(char);
  const gender = char.gender || 'male';
  const inv = (char.inventory || []).filter(i => itemEquipSlot(i));
  const grid = document.getElementById('eq-inv-grid');
  if (!inv.length) {
    grid.innerHTML = `<p class="muted-sm">${t('game.js.no_equippable')}</p>`;
    return;
  }

  grid.innerHTML = inv.map((item, idx) => {
    const slot = itemEquipSlot(item);
    const isEq = slot && equippedBySlot[slot] === item.item_id;
    const statLine = item.damage
      ? `⚔️ ${item.damage} ${t('game.js.dmg_unit')}`
      : item.defense ? `🛡️ ${item.defense} ${t('game.js.def_unit')}` : '';
    const label = `${tItemName(item)}${statLine ? ' · ' + statLine : ''}`;
    return `<div class="eq-inv-slot${isEq ? ' equipped' : ''}"
               draggable="true"
               data-idx="${idx}"
               data-item-id="${item.item_id}"
               data-slot="${slot}"
               title="${escHtml(label)}"
               onclick="eqInvSlotClick(${item.item_id}, '${slot}')">
      ${itemIconHtml(item.item_id, item.icon, tItemName(item), gender, 'inv-item-img')}
    </div>`;
  }).join('');

  _eqAttachDragListeners(char);
}

function eqInvSlotClick(itemId, slot) {
  if (!charState) return;
  const equippedBySlot = equippedSlotMap(charState);
  if (equippedBySlot[slot] === itemId) {
    unequipItem(slot);
  } else {
    equipItem(slot, itemId);
  }
}

// ---- Drag & drop ----
let _dragItem = null;   // { itemId, slot }
let _touchGhost = null;

function _eqAttachDragListeners(char) {
  const inv = (char.inventory || []).filter(i => itemEquipSlot(i));
  const slots = ['weapon', 'armor', 'shield', 'arm', 'boots', 'helmet'];

  // Draggable inventory cells
  document.querySelectorAll('#eq-inv-grid .eq-inv-slot').forEach((el, idx) => {
    const item = inv[idx];
    if (!item) return;
    const itemSlot = itemEquipSlot(item);

    el.addEventListener('dragstart', e => {
      _dragItem = { itemId: item.item_id, slot: itemSlot };
      e.dataTransfer.setData('text/plain', JSON.stringify(_dragItem));
      e.dataTransfer.effectAllowed = 'move';
      // Custom drag image: clone the cell
      const ghost = el.cloneNode(true);
      ghost.style.cssText = 'position:fixed;top:-200px;left:-200px;width:60px;height:60px;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 30, 30);
      requestAnimationFrame(() => document.body.removeChild(ghost));
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      _dragItem = null;
      _eqClearDropHighlights();
    });

    // Touch events
    el.addEventListener('touchstart', e => _eqTouchStart(e, item, itemSlot), { passive: true });
    el.addEventListener('touchmove',  _eqTouchMove, { passive: true });
    el.addEventListener('touchend',   _eqTouchEnd);
  });

  // Drop targets: the three doll slots
  slots.forEach(slotName => {
    const el = document.getElementById(`eq-slot-${slotName}`);
    if (!el) return;

    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (!_dragItem) return;
      if (_dragItem.slot === slotName) {
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drop-target-valid');
        el.classList.remove('drop-target-invalid');
      } else {
        e.dataTransfer.dropEffect = 'none';
        el.classList.add('drop-target-invalid');
        el.classList.remove('drop-target-valid');
      }
    });

    el.addEventListener('dragenter', e => { e.preventDefault(); });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-target-valid', 'drop-target-invalid');
    });

    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drop-target-valid', 'drop-target-invalid');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!data || data.slot !== slotName) return;
      equipItem(slotName, data.itemId);
    });
  });
}

function _eqClearDropHighlights() {
  ['weapon', 'armor', 'shield', 'arm', 'boots', 'helmet'].forEach(s => {
    const el = document.getElementById(`eq-slot-${s}`);
    if (el) el.classList.remove('drop-target-valid', 'drop-target-invalid');
  });
}

// Touch drag helpers
function _eqTouchStart(e, item, itemSlot) {
  _dragItem = { itemId: item.item_id, slot: itemSlot };
  const touch = e.touches[0];
  _touchGhost = document.createElement('div');
  _touchGhost.className = 'drag-ghost';
  _touchGhost.textContent = item.icon || '📦';
  _touchGhost.style.left = touch.clientX + 'px';
  _touchGhost.style.top  = touch.clientY + 'px';
  document.body.appendChild(_touchGhost);
}

function _eqTouchMove(e) {
  if (!_touchGhost || !_dragItem) return;
  const touch = e.touches[0];
  _touchGhost.style.left = touch.clientX + 'px';
  _touchGhost.style.top  = touch.clientY + 'px';

  // Highlight slots under finger
  _eqClearDropHighlights();
  const target = _eqSlotUnderPoint(touch.clientX, touch.clientY);
  if (target) {
    const slotName = target.dataset.slot;
    target.classList.add(_dragItem.slot === slotName ? 'drop-target-valid' : 'drop-target-invalid');
  }
}

function _eqTouchEnd(e) {
  if (!_touchGhost) return;
  document.body.removeChild(_touchGhost);
  _touchGhost = null;
  _eqClearDropHighlights();

  if (!_dragItem) return;
  const touch = e.changedTouches[0];
  const target = _eqSlotUnderPoint(touch.clientX, touch.clientY);
  if (target && target.dataset.slot === _dragItem.slot) {
    equipItem(_dragItem.slot, _dragItem.itemId);
  }
  _dragItem = null;
}

function _eqSlotUnderPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest('.eq-doll-slot[data-slot]');
}

async function equipItem(slot, itemId) {
  const res = await api.put(`/api/characters/${charId}/equip`, { slot, item_id: itemId });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.cant_equip'), 'danger'); return; }
  charState = { ...charState, ...data };
  renderEquipment(charState);
  renderInventory(charState);
  renderCharAvatar(document.getElementById('avatar-display'), charState);
  showToast(t('game.js.item_equipped'), 'success');
  refreshCombatStats();
}

async function unequipItem(slot) {
  const res = await api.put(`/api/characters/${charId}/equip`, { slot, item_id: null });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.cant_equip'), 'danger'); return; }
  charState = { ...charState, ...data };
  renderEquipment(charState);
  renderInventory(charState);
  renderCharAvatar(document.getElementById('avatar-display'), charState);
  showToast(t('game.js.item_unequipped'), 'success');
  refreshCombatStats();
}

// ---- Attributes ----
function renderAttributes(char) {
  if (!char) return;
  const unspent = Number(char.unspent_points) || 0;
  const pendingTotal = Object.values(pendingAttrs).reduce((s, v) => s + v, 0);
  const remaining = unspent - pendingTotal;

  const bar = document.getElementById('attr-unspent-bar');
  const pointsEl = document.getElementById('attr-points-left');
  if (unspent > 0) {
    bar.classList.add('visible');
    pointsEl.textContent = `${remaining} / ${unspent}`;
  } else {
    bar.classList.remove('visible');
  }

  document.getElementById('attr-confirm-row').classList.toggle('visible', pendingTotal > 0);

  const list = document.getElementById('attr-list');
  list.innerHTML = ATTRS.map(({ key, labelKey, hintKey }) => {
    const base  = Number(char[`attr_${key}`]) || 5;
    const delta = pendingAttrs[key] || 0;
    const label = t(labelKey) || key;
    const hint  = t(hintKey)  || '';
    return `
      <div class="attr-row">
        <span class="attr-name" title="${hint}">${label}</span>
        <span class="attr-value">${base}</span>
        ${unspent > 0 ? `
          <span class="attr-pending">${delta > 0 ? '+' + delta : ''}</span>
          <button type="button" class="attr-btn" onclick="adjustAttr('${key}',-1)" ${delta <= 0 ? 'disabled' : ''}>−</button>
          <button type="button" class="attr-btn" onclick="adjustAttr('${key}',1)"  ${remaining <= 0 ? 'disabled' : ''}>+</button>
        ` : ''}
      </div>`;
  }).join('');
}

function adjustAttr(key, delta) {
  if (!charState) return;
  const unspent = Number(charState.unspent_points) || 0;
  const pendingTotal = Object.values(pendingAttrs).reduce((s, v) => s + v, 0);
  const current = pendingAttrs[key] || 0;
  if (delta > 0 && pendingTotal >= unspent) return;
  if (delta < 0 && current <= 0) return;
  pendingAttrs[key] = current + delta;
  if (pendingAttrs[key] === 0) delete pendingAttrs[key];
  renderAttributes(charState);
  if (lastGearStats && charState) {
    const hasPending = Object.keys(pendingAttrs).length > 0;
    renderCombatStats(lastGearStats, hasPending ? calcLocalStats(charState, pendingAttrs, lastGearStats) : null);
  }
}

async function confirmAttributes() {
  if (!Object.keys(pendingAttrs).length) return;
  const res = await api.put(`/api/characters/${charId}/attributes`, { allocations: pendingAttrs });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.cant_attrs'), 'danger'); return; }
  pendingAttrs = {};
  charState = { ...charState, ...data };
  renderAll(charState);
  showToast(t('game.js.attrs_updated'), 'success');
  refreshCombatStats();
}

function handleRead() {
  if (!charState) return;
  if (farmEndsAt) return;
  if (charState.activity === 'reading') { stopActivity(); return; }
  if (!charState.activity) openReadModal();
}

// ---- Farm Modal ----
// ---- Read ----
const BOOKS = [
  { id: 'fairy_tale', name: 'Fairy Tale', icon: '📖', durationSec: 3600, reward: '+1 Stamina', desc: '1 hour · +1 Stamina' },
];

let selectedBook     = BOOKS[0];
let readStartedAt    = null; // ms timestamp

function openReadModal() {
  selectedBook = BOOKS[0];
  renderReadBookList();
  document.getElementById('read-modal').classList.add('open');
}

function closeReadModal() {
  document.getElementById('read-modal').classList.remove('open');
}

function renderReadBookList() {
  const container = document.getElementById('read-book-list');
  container.innerHTML = BOOKS.map(book => `
    <div class="read-book-card${selectedBook.id === book.id ? ' selected' : ''}"
         onclick="selectBook('${book.id}')">
      <div class="read-book-card-left">
        <span class="read-book-icon">${book.icon}</span>
        <div class="read-book-info">
          <span class="read-book-name">${escHtml(book.name)}</span>
          <span class="read-book-desc">${escHtml(book.desc)}</span>
        </div>
      </div>
      <span class="read-book-reward">${escHtml(book.reward)}</span>
    </div>
  `).join('');
}

function selectBook(bookId) {
  selectedBook = BOOKS.find(b => b.id === bookId) || BOOKS[0];
  renderReadBookList();
}

async function confirmStartReading() {
  closeReadModal();
  const res = await api.post(`/api/game/${charId}/start`, { action: 'reading', bookId: selectedBook.id });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed'), 'danger'); return; }
  charState = data;
  readStartedAt = Date.now();
  startLocalTimer();
  renderAll(data);
  showToast(t('game.js.reading_start'), 'success');
}

function updateReadProgressBar() {
  const btn = document.getElementById('sq-read');
  if (!btn) return;
  if (!readStartedAt) { btn.style.setProperty('--read-progress', '0%'); return; }
  const elapsedSec = (Date.now() - readStartedAt) / 1000;
  btn.style.setProperty('--read-progress', Math.min(100, (elapsedSec / 3600) * 100) + '%');
}

document.getElementById('read-modal').addEventListener('click', function(e) {
  if (e.target === this) closeReadModal();
});

// ---- Fishing ----

// itemId must match seeds in server/db.js (IDs 37–40 = baits, 41 = fish)
const FISHING_BAITS = [
  { itemId: 37, name: 'Worm Bait',    icon: '🪱', desc: 'Basic bait'   },
  { itemId: 38, name: 'Fly Bait',     icon: '🪰', desc: '+5 bonus XP'  },
  { itemId: 39, name: 'Fishing Lure', icon: '✨', desc: '+10 bonus XP' },
  { itemId: 40, name: 'Bread Bait',   icon: '🍞', desc: '+5 bonus XP'  },
];

const FISH_ZONE_START  = 0.55;   // green zone: 55–75% of track width
const FISH_ZONE_END    = 0.75;
const FISH_CYCLE_MS    = 2000;
const FISH_MAX_TRIES   = 3;

let selectedBait    = null;
let fishAttempts    = 0;
let fishAnimId      = null;
let fishAnimActive  = false;
let fishAnimStart   = null;

function handleFishing() {
  if (!charState) return;
  if (charState.activity) return;
  if (charState.farmQueue?.length) return;
  openFishingModal();
}

function openFishingModal() {
  selectedBait = null;
  fishAttempts = 0;
  renderFishingBaitGrid();
  document.getElementById('fishing-minigame').style.display = 'none';
  document.getElementById('fishing-modal').classList.add('open');
}

function closeFishingModal() {
  stopFishingAnimation();
  selectedBait = null;
  fishAttempts = 0;
  document.getElementById('fishing-modal').classList.remove('open');
}

function fishingBaitQty(itemId) {
  if (!charState) return 0;
  return charState.inventory.find(i => i.item_id === itemId)?.quantity ?? 0;
}

function renderFishingBaitGrid() {
  const container = document.getElementById('fishing-bait-grid');
  container.innerHTML = FISHING_BAITS.map(b => {
    const qty     = fishingBaitQty(b.itemId);
    const isSelected = selectedBait && selectedBait.itemId === b.itemId;
    const disabled   = qty === 0;
    return `
      <div class="fishing-bait-card${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}"
           onclick="${disabled ? `openMarketFromFishing()` : `selectFishingBait(${b.itemId})`}">
        <span class="fishing-bait-icon">${b.icon}</span>
        <span class="fishing-bait-name">${escHtml(b.name)}</span>
        <span class="fishing-bait-desc">${disabled ? '🛒 Buy at market' : escHtml(b.desc)}</span>
        ${qty > 0 ? `<span class="fishing-bait-qty">×${qty}</span>` : ''}
      </div>
    `;
  }).join('');
}

function openMarketFromFishing() {
  closeFishingModal();
  openPanel('market');
  switchMarketTab('buy');
}

function selectFishingBait(itemId) {
  selectedBait = FISHING_BAITS.find(b => b.itemId === itemId) || null;
  fishAttempts = 0;
  renderFishingBaitGrid();

  const minigame  = document.getElementById('fishing-minigame');
  const retryHint = document.getElementById('fish-retry-hint');
  const track     = document.getElementById('fish-track');
  const attemptsEl = document.getElementById('fish-attempts');

  minigame.style.display = 'block';
  retryHint.style.display = 'none';
  track.classList.remove('fish-success', 'fish-fail');
  if (attemptsEl) attemptsEl.textContent = `${FISH_MAX_TRIES - fishAttempts} tries left`;

  stopFishingAnimation();
  startFishingAnimation();
}

function startFishingAnimation() {
  fishAnimActive = true;
  fishAnimStart  = null;
  fishAnimId     = requestAnimationFrame(tickFishingAnimation);
}

function stopFishingAnimation() {
  fishAnimActive = false;
  if (fishAnimId) { cancelAnimationFrame(fishAnimId); fishAnimId = null; }
}

function tickFishingAnimation(ts) {
  if (!fishAnimActive) return;
  if (!fishAnimStart) fishAnimStart = ts;

  const phase = ((ts - fishAnimStart) % FISH_CYCLE_MS) / FISH_CYCLE_MS;
  const pos   = phase < 0.5 ? phase * 2 : (1 - phase) * 2;

  const slider = document.getElementById('fish-slider');
  const track  = document.getElementById('fish-track');
  if (!slider || !track) { fishAnimActive = false; return; }

  slider.style.left = (pos * (track.offsetWidth - slider.offsetWidth)) + 'px';

  const hookBtn = document.getElementById('fish-hook-btn');
  if (hookBtn) hookBtn.classList.toggle('in-zone', pos >= FISH_ZONE_START && pos <= FISH_ZONE_END);

  fishAnimId = requestAnimationFrame(tickFishingAnimation);
}

function clickFishHook() {
  if (!fishAnimActive || !selectedBait) return;

  const slider = document.getElementById('fish-slider');
  const track  = document.getElementById('fish-track');
  if (!slider || !track) return;

  const trackRect    = track.getBoundingClientRect();
  const sliderRect   = slider.getBoundingClientRect();
  const sliderCenter = sliderRect.left - trackRect.left + sliderRect.width / 2;
  const hit = sliderCenter >= trackRect.width * FISH_ZONE_START &&
              sliderCenter <= trackRect.width * FISH_ZONE_END;

  stopFishingAnimation();

  if (hit) {
    track.classList.add('fish-success');
    setTimeout(() => submitFishingResult(true), 600);
  } else {
    fishAttempts++;
    const triesLeft = FISH_MAX_TRIES - fishAttempts;

    if (triesLeft <= 0) {
      // Out of attempts — consume bait, no fish
      track.classList.add('fish-fail');
      const retryHint = document.getElementById('fish-retry-hint');
      retryHint.textContent = 'The fish got away! Bait used up.';
      retryHint.style.display = 'block';
      setTimeout(() => submitFishingResult(false), 1000);
    } else {
      track.classList.add('fish-fail');
      const attemptsEl = document.getElementById('fish-attempts');
      if (attemptsEl) attemptsEl.textContent = `${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left`;
      setTimeout(() => {
        track.classList.remove('fish-fail');
        document.getElementById('fish-retry-hint').textContent = 'Missed! Try again…';
        document.getElementById('fish-retry-hint').style.display = 'block';
        startFishingAnimation();
      }, 900);
    }
  }
}

async function submitFishingResult(caught) {
  const baitItemId = selectedBait ? selectedBait.itemId : null;
  closeFishingModal();
  if (!baitItemId) return;

  const res = await api.post(`/api/game/${charId}/fish`, { baitItemId, caught });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed'), 'danger'); return; }
  charState = data;
  renderAll(data);
  if (caught) {
    showToast(t('game.js.fishing_success').replace('{xp}', data.fishXp), 'success');
  }
}

document.getElementById('fishing-modal').addEventListener('click', function(e) {
  if (e.target === this) closeFishingModal();
});

const FARM_PLANTS = [
  { type: 'carrot', label: 'Carrot', img: '/img/carrot_icon.png' },
  { type: 'apple',  label: 'Apple',  img: '/img/apple_icon.png'  },
  { type: 'onion',  label: 'Onion',  img: '/img/onion_icon.png'  },
  { type: 'corn',   label: 'Corn',   img: '/img/corn.png'   },
];
const FARM_MAX_SLOTS = 12;

let farmSlots        = [null];
let farmEndsAt       = null;
let farmTotalMs      = null;
let farmLocalTimer   = null;
let farmPollInterval = null;

function handleFarm() {
  if (!charState) return;
  if (Number(charState.level) < 3) { showToast(t('game.js.farm_unlock'), 'danger'); return; }
  if (charState.activity && charState.activity !== 'farm') return;
  openFarmModal();
}

function renderFarmXpBar() {
  const level    = charState?.farmLevel    || 1;
  const xp       = charState?.farmXp       || 0;
  const xpToNext = charState?.farmXpToNext || (level * 5);
  const pct      = level >= FARM_MAX_SLOTS ? 100 : Math.min(100, Math.round(xp / xpToNext * 100));

  const labelEl = document.getElementById('farm-level-label');
  const textEl  = document.getElementById('farm-xp-text');
  const fillEl  = document.getElementById('farm-xp-fill');
  if (!labelEl) return;

  labelEl.textContent = `Farm Lv.${level}`;
  textEl.textContent  = level >= FARM_MAX_SLOTS ? 'Max level' : `${xp} / ${xpToNext} XP`;
  fillEl.style.width  = pct + '%';
}

function openFarmModal() {
  const queue = charState?.farmQueue || [];
  renderFarmXpBar();
  if (queue.length > 0) {
    document.getElementById('farm-planting-view').style.display = 'none';
    document.getElementById('farm-growing-view').style.display  = '';
    renderFarmGrowingView();
  } else {
    farmSlots = Array(charState?.farmLevel || 1).fill(null);
    document.getElementById('farm-growing-view').style.display  = 'none';
    document.getElementById('farm-planting-view').style.display = '';
    renderFarmPalette();
    renderFarmSlots();
    updateFarmStartBtn();
  }
  document.getElementById('farm-modal').classList.add('open');
}

function closeFarmModal() {
  document.getElementById('farm-modal').classList.remove('open');
}

document.getElementById('farm-modal').addEventListener('click', function(e) {
  if (e.target === this) closeFarmModal();
});

function renderFarmPalette() {
  const palette = document.getElementById('farm-plant-palette');
  palette.innerHTML = FARM_PLANTS.map(p => `
    <div class="plant-card" draggable="true"
         ondragstart="farmDragStart(event,'${p.type}')">
      <img src="${p.img}" alt="${escHtml(p.label)}" />
      <span>${escHtml(p.label)}</span>
    </div>
  `).join('');
}

function farmDragStart(e, plantType) {
  e.dataTransfer.setData('plant-type', plantType);
  e.dataTransfer.effectAllowed = 'copy';
}

function renderFarmSlots() {
  const container = document.getElementById('farm-slots');
  container.innerHTML = '';
  const slotCount = charState?.farmLevel || 1;
  for (let i = 0; i < FARM_MAX_SLOTS; i++) {
    const locked = i >= slotCount;
    const slot = document.createElement('div');
    slot.className = locked ? 'farm-slot farm-slot-locked' : 'farm-slot';

    if (!locked && farmSlots[i]) {
      const plant = FARM_PLANTS.find(p => p.type === farmSlots[i]);
      if (plant) {
        slot.classList.add('occupied');
        const img = document.createElement('img');
        img.src = plant.img;
        img.alt = plant.label;
        slot.appendChild(img);
      }
    }

    if (locked) { container.appendChild(slot); continue; }

    slot.addEventListener('dragover',  (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', ()  => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const pt = e.dataTransfer.getData('plant-type');
      if (pt) { farmSlots[i] = pt; renderFarmSlots(); updateFarmStartBtn(); }
    });
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (farmSlots[i]) { farmSlots[i] = null; renderFarmSlots(); updateFarmStartBtn(); }
    });

    container.appendChild(slot);
  }
}

function updateFarmStartBtn() {
  const count = farmSlots.filter(Boolean).length;
  document.getElementById('farm-start-btn').disabled = count === 0;
  const slotMax = charState?.farmLevel || 1;
  document.getElementById('farm-slot-count').textContent = `${count} / ${slotMax} planted`;
}

async function startFarmGrow() {
  const btn = document.getElementById('farm-start-btn');
  btn.disabled = true;
  const res = await api.post(`/api/farm/${charId}/start`, { slots: farmSlots });
  if (!res) { btn.disabled = false; return; }
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to start growing', 'danger'); btn.disabled = false; return; }

  charState = { ...charState, farmQueue: data.farmQueue, farmLevel: data.farmLevel ?? charState.farmLevel, farmXp: data.farmXp ?? charState.farmXp, farmXpToNext: data.farmXpToNext ?? charState.farmXpToNext };
  if (data.durationSeconds > 0) {
    farmTotalMs = data.durationSeconds * 1000;
    farmEndsAt  = Date.now() + farmTotalMs;
    localStorage.setItem('farmEndsAt',  farmEndsAt);
    localStorage.setItem('farmTotalMs', farmTotalMs);
    startFarmLocalTimer();
    startFarmPoll();
  }
  closeFarmModal();
  renderAll(charState);
  showToast('🌱 Plants are growing!', 'success');
}

async function cancelFarmGrow() {
  const res = await api.delete(`/api/farm/${charId}`);
  if (!res || !res.ok) { showToast('Failed to cancel', 'danger'); return; }
  stopFarmLocalTimer();
  stopFarmPoll();
  farmEndsAt = null;
  farmTotalMs = null;
  localStorage.removeItem('farmEndsAt');
  localStorage.removeItem('farmTotalMs');
  farmSlots = Array(charState?.farmLevel || 1).fill(null);
  charState = { ...charState, farmQueue: [] };
  renderAll(charState);
  // Switch back to planting view inside modal if it's open
  const growView = document.getElementById('farm-growing-view');
  const plantView = document.getElementById('farm-planting-view');
  if (growView) growView.style.display = 'none';
  if (plantView) plantView.style.display = '';
  renderFarmSlots();
  showToast('Grow cancelled', 'info');
}

function renderFarmGrowingView() {
  const queue = charState?.farmQueue || [];
  const maxReadyAt = queue.length ? Math.max(...queue.map(j => Number(j.ready_at))) : 0;
  const remainingMs = Math.max(0, maxReadyAt * 1000 - Date.now());
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  const timerEl = document.getElementById('farm-modal-timer');
  timerEl.textContent = remainingMs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : '✅ Ready!';

  const counts = {};
  queue.forEach(j => { counts[j.plant_type] = (counts[j.plant_type] || 0) + 1; });
  document.getElementById('farm-growing-list').innerHTML = Object.entries(counts).map(([type, cnt]) => {
    const plant = FARM_PLANTS.find(p => p.type === type) || { label: type, img: `/img/${type}.png` };
    return `<div class="farm-growing-item">
      <img src="${plant.img}" alt="${escHtml(plant.label)}" />
      <span>${escHtml(plant.label)} ×${cnt}</span>
    </div>`;
  }).join('');
}

// ---- Farm timer (local 1-second tick for badge + modal countdown) ----
function startFarmLocalTimer() {
  if (farmLocalTimer) clearInterval(farmLocalTimer);
  farmLocalTimer = setInterval(() => {
    updateFarmTimerBadge();
    // If farm-growing-view is visible, refresh its countdown
    const growView = document.getElementById('farm-growing-view');
    if (growView && growView.style.display !== 'none' && document.getElementById('farm-modal').classList.contains('open')) {
      renderFarmGrowingView();
    }
  }, 1000);
  updateFarmTimerBadge();
}

function stopFarmLocalTimer() {
  if (farmLocalTimer) clearInterval(farmLocalTimer);
  farmLocalTimer = null;
}

function updateFarmTimerBadge() {
  const btn = document.getElementById('sq-farm');
  if (!btn) return;
  if (!farmEndsAt || !farmTotalMs) { btn.style.setProperty('--farm-progress', '0%'); return; }
  const remainingMs = Math.max(0, farmEndsAt - Date.now());
  if (remainingMs === 0) { btn.style.setProperty('--farm-progress', '0%'); stopFarmLocalTimer(); return; }
  const pct = Math.min(100, (1 - remainingMs / farmTotalMs) * 100).toFixed(1);
  btn.style.setProperty('--farm-progress', pct + '%');
}

// ---- Farm poll ----
function startFarmPoll() {
  if (farmPollInterval) clearInterval(farmPollInterval);
  farmPollInterval = setInterval(pollFarmStatus, 5000);
}

function stopFarmPoll() {
  if (farmPollInterval) clearInterval(farmPollInterval);
  farmPollInterval = null;
}

async function pollFarmStatus() {
  if (!farmEndsAt || Date.now() < farmEndsAt) return;

  stopFarmPoll();
  stopFarmLocalTimer();

  const res = await api.get(`/api/farm/${charId}/harvest`);
  if (!res || !res.ok) return;
  const data = await res.json();

  farmEndsAt = null;
  farmTotalMs = null;
  localStorage.removeItem('farmEndsAt');
  localStorage.removeItem('farmTotalMs');
  updateFarmTimerBadge();

  // Refresh full char state
  const tickRes = await api.get(`/api/game/${charId}/tick`);
  if (tickRes && tickRes.ok) {
    charState = await tickRes.json();
    renderAll(charState);
  } else {
    charState = { ...charState, farmQueue: [] };
    renderAll(charState);
  }

  if (data.harvested && data.harvested.length > 0) {
    showFarmHarvestModal(data.harvested);
  }

  // Close growing view in modal if open
  const modal = document.getElementById('farm-modal');
  if (modal.classList.contains('open')) {
    document.getElementById('farm-growing-view').style.display  = 'none';
    document.getElementById('farm-planting-view').style.display = '';
    farmSlots = Array(charState?.farmLevel || 1).fill(null);
    renderFarmXpBar();
    renderFarmPalette();
    renderFarmSlots();
    updateFarmStartBtn();
  }
}

function showFarmHarvestModal(harvested) {
  document.getElementById('loot-modal-title').textContent = '🌾 Harvest Complete!';
  document.getElementById('loot-xp-row').textContent      = '';
  document.getElementById('loot-gold-row').textContent    = '';
  const buffRow = document.getElementById('loot-buff-row');
  if (buffRow) buffRow.classList.add('hidden');

  const lootList = document.getElementById('loot-list');
  lootList.innerHTML = harvested.map(item => {
    const plant = FARM_PLANTS.find(p => p.type === item.plant_type) || { label: item.plant_type, img: `/img/${item.plant_type}.png` };
    return `<div class="loot-item-row">
      <img src="${plant.img}" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;" alt="${escHtml(plant.label)}" />
      <span class="loot-item-name">${escHtml(plant.label)}</span>
      <span class="loot-item-qty">×${item.quantity}</span>
    </div>`;
  }).join('');

  document.getElementById('loot-modal').classList.add('open');
}

// ---- Market ----
let marketTab = 'sell';
let shopCategory = 'food';
let selectedSellInvId = null;
let selectedBuyItemId = null;
let selectedInvIdx    = null;
let shopItemsCache    = {};

function switchMarketTab(tab) {
  clearSellSelection();
  clearBuySelection();
  marketTab = tab;
  document.getElementById('market-tab-sell').classList.toggle('active', tab === 'sell');
  document.getElementById('market-tab-buy').classList.toggle('active', tab === 'buy');
  document.getElementById('market-sell-pane').style.display = tab === 'sell' ? '' : 'none';
  document.getElementById('market-buy-pane').style.display  = tab === 'buy'  ? '' : 'none';
  if (tab === 'buy') renderShopPane();
}

function switchShopCategory(cat) {
  clearBuySelection();
  shopCategory = cat;
  ['food', 'potions', 'armor', 'others'].forEach(c => {
    document.getElementById(`market-buy-tab-${c}`).classList.toggle('active', c === cat);
  });
  renderShopPane();
}

function itemMatchesCategory(item, cat) {
  const isPotion = item.item_subtype === 'adventure_potion';
  if (cat === 'potions') return isPotion;
  if (cat === 'food')    return item.type === 'consumable' && !isPotion;
  if (cat === 'armor')   return item.type === 'armor';
  return item.type !== 'consumable' && item.type !== 'armor';
}

// ---- Global market tooltip (escapes opacity stacking context of cant-afford cells) ----
const mktTip = document.getElementById('market-tooltip-global');

function showMarketTooltip(html, e) {
  mktTip.innerHTML = html;
  mktTip.style.display = 'block';
  positionMarketTooltip(e);
}

function positionMarketTooltip(e) {
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const rect = mktTip.getBoundingClientRect();
  if (x + rect.width  > window.innerWidth  - 8) x = e.clientX - rect.width  - pad;
  if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
  mktTip.style.left = x + 'px';
  mktTip.style.top  = y + 'px';
}

function hideMarketTooltip() {
  mktTip.style.display = 'none';
}

function attachMarketTooltip(container, getHtml) {
  container.querySelectorAll('.market-cell').forEach(cell => {
    cell.addEventListener('mouseenter', e => showMarketTooltip(getHtml(cell), e));
    cell.addEventListener('mousemove',  e => positionMarketTooltip(e));
    cell.addEventListener('mouseleave', ()  => hideMarketTooltip());
  });
}

function renderMarketPanel(char) {
  if (!char) return;
  const prevSellInvId = selectedSellInvId;
  selectedSellInvId = null;
  const gold = Number(char.gold) || 0;
  document.getElementById('market-gold-amount').textContent = `🪙 ${gold}g`;

  const equippedIds = new Set(
    [char.weapon_id, char.armor_id, char.shield_id, char.arm_id, char.boots_id, char.helmet_id]
      .filter(Boolean).map(Number)
  );
  const sellable = (char.inventory || []).filter(i => Number(i.sell_price) > 0);
  const list = document.getElementById('market-list');

  if (!sellable.length) {
    list.innerHTML = `<p class="muted-sm">${t('game.js.nothing_to_sell')}</p>`;
    return;
  }

  const gender = char.gender || 'male';
  list.innerHTML = `<div class="market-grid">${sellable.map(item => {
    const equipped    = equippedIds.has(Number(item.item_id));
    const canClick    = !equipped || item.quantity > 1;
    const price       = Number(item.sell_price);
    const qtyLabel    = item.quantity > 1 ? `×${item.quantity}` : '';
    const clickAttr   = canClick ? `onclick="selectSellItem(${item.id},${item.item_id})"` : '';
    const tipHtml     = `
      <div class="market-tooltip-name">${escHtml(tItemName(item))}</div>
      <div class="market-tooltip-meta">
        ${t('game.js.qty')}: ${item.quantity}<br>
        <span class="market-tooltip-price">🪙 ${price}g ${t('game.js.each')}</span>
      </div>
      ${equipped
        ? `<div class="market-tooltip-equipped">${t('game.js.equipped_tag')}${item.quantity > 1 ? ` · ${t('game.js.click_to_sell')}` : ''}</div>`
        : `<span class="market-tooltip-sell">${t('game.js.click_to_sell')}</span>`}`;
    return `
      <div class="market-cell${equipped ? ' equipped' : ''}${canClick ? '' : ' no-click'}" ${clickAttr} data-inv-id="${item.id}" data-tip="${escHtml(tipHtml)}">
        ${itemIconHtml(item.item_id, item.icon, tItemName(item), gender, 'market-item-img')}
        ${qtyLabel ? `<span class="market-cell-qty">${qtyLabel}</span>` : ''}
      </div>`;
  }).join('')}</div><div id="sell-detail-panel"></div>`;

  attachMarketTooltip(list, cell => cell.dataset.tip || '');

  // restore selection if an item was open before the re-render
  if (prevSellInvId !== null) {
    const item = (char.inventory || []).find(i => i.id === prevSellInvId);
    if (item) selectSellItem(item.id, item.item_id);
  }
}

async function renderShopPane() {
  const shopList = document.getElementById('market-shop-list');
  const prevBuyItemId = selectedBuyItemId;
  selectedBuyItemId = null;
  shopList.innerHTML = `<p class="muted-sm">${t('game.js.loading')}</p>`;
  const res = await api.get(`/api/market/${charId}/shop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { shopList.innerHTML = `<p class="muted-sm">${data.error}</p>`; return; }

  const allItems = data.items || [];
  const items = allItems.filter(i => itemMatchesCategory(i, shopCategory));
  items.forEach(i => { shopItemsCache[i.id] = i; });

  if (!items.length) {
    shopList.innerHTML = `<p class="muted-sm">${t('game.js.shop_empty')}</p>`;
    return;
  }

  const gold   = Number(charState?.gold) || 0;
  const gender = charState?.gender || 'male';
  shopList.innerHTML = `<div class="market-grid">${items.map(item => {
    const price     = Number(item.buy_price);
    const canAfford = gold >= price;
    let stats = '';
    if (item.damage  > 0) stats += `<br>${item.damage} ${t('game.js.dmg_unit')}`;
    if (item.defense > 0) stats += `<br>${item.defense} ${t('game.js.def_unit')}`;
    let buffLine = '';
    if (item.item_subtype === 'adventure_potion' && item.buff_effect) {
      try {
        const b = JSON.parse(item.buff_effect);
        const BUFF_LABELS = {
          speed:         '⚡ −30% dungeon time',
          loot_quality:  '🍀 Improved loot quality',
          loot_count:    '🎁 +2 extra loot items',
          stamina:       '💚 +1 stamina on completion',
          xp_multiplier: '📚 ×2 XP gain',
        };
        if (BUFF_LABELS[b.type]) buffLine = `<span class="market-tooltip-buff">${BUFF_LABELS[b.type]}</span>`;
      } catch { /* ignore */ }
    }
    const tipHtml = `
      <div class="market-tooltip-name">${escHtml(tItemName(item))}</div>
      <div class="market-tooltip-meta">
        <span class="market-tooltip-price">🪙 ${price}g</span>${stats}
      </div>
      ${buffLine}
      ${canAfford
        ? `<span class="market-tooltip-sell">${t('game.js.click_to_buy')}</span>`
        : `<div class="market-tooltip-equipped">${t('game.js.cant_afford')}</div>`}`;
    return `
      <div class="market-cell${canAfford ? '' : ' cant-afford'}" onclick="selectBuyItem(${item.id})" data-item-id="${item.id}" data-tip="${escHtml(tipHtml)}">
        ${itemIconHtml(item.id, item.icon, tItemName(item), gender, 'market-item-img')}
      </div>`;
  }).join('')}</div><div id="buy-detail-panel"></div>`;

  attachMarketTooltip(shopList, cell => cell.dataset.tip || '');

  // restore selection if an item was open before the re-render
  if (prevBuyItemId !== null && shopItemsCache[prevBuyItemId]) {
    selectBuyItem(prevBuyItemId);
  }
}

function selectSellItem(invId, itemId) {
  const item = (charState?.inventory || []).find(i => i.id === invId);
  if (!item) return;
  selectedSellInvId = invId;

  document.querySelectorAll('#market-list .market-cell').forEach(c => {
    c.classList.toggle('selected', Number(c.dataset.invId) === invId);
  });

  const price = Number(item.sell_price);
  const statLine = item.damage  ? `<div class="item-detail-stat">⚔️ ${item.damage} ${t('game.js.dmg_unit')}</div>`
                 : item.defense ? `<div class="item-detail-stat">🛡️ ${item.defense} ${t('game.js.def_unit')}</div>`
                 : '';

  const equippedIds = [
    charState?.equippedWeapon?.id, charState?.equippedArmor?.id, charState?.equippedShield?.id,
    charState?.equippedArm?.id,    charState?.equippedBoots?.id,  charState?.equippedHelmet?.id,
  ].filter(Boolean).map(Number);
  const isEquipped  = equippedIds.includes(Number(item.item_id));
  const maxSellable = isEquipped ? item.quantity - 1 : item.quantity;
  const equippedNote = isEquipped ? `<div class="item-detail-equipped-note">${t('game.js.equipped_note', { n: maxSellable })}</div>` : '';

  const panel = document.getElementById('sell-detail-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="item-detail-panel">
      <div class="item-detail-header">
        ${itemIconHtml(item.item_id, item.icon, tItemName(item), charState?.gender, 'item-detail-icon-img')}
        <div>
          <div class="item-detail-name">${escHtml(tItemName(item))}</div>
          <div class="item-detail-type">${tItemType(item)}</div>
        </div>
      </div>
      <div class="item-detail-meta">🪙 ${price}g ${t('game.js.each')} · ${t('game.js.qty')}: ${item.quantity}</div>
      ${statLine}
      ${equippedNote}
      <div class="item-detail-actions">
        <button type="button" class="btn btn-danger btn-sm" ${maxSellable <= 0 ? 'disabled' : `onclick="sellItem(${invId},${itemId},${maxSellable})"`}>${t('game.js.sell_btn')}</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="clearSellSelection()">${t('game.js.cancel_btn')}</button>
      </div>
    </div>`;
}

function clearSellSelection() {
  selectedSellInvId = null;
  document.querySelectorAll('#market-list .market-cell').forEach(c => c.classList.remove('selected'));
  const panel = document.getElementById('sell-detail-panel');
  if (panel) panel.innerHTML = '';
}

function selectBuyItem(itemId) {
  const item = shopItemsCache[itemId];
  if (!item) return;
  selectedBuyItemId = itemId;
  const gold = Number(charState?.gold) || 0;
  const price = Number(item.buy_price);
  const canAfford = gold >= price;

  document.querySelectorAll('#market-shop-list .market-cell').forEach(c => {
    c.classList.toggle('selected', Number(c.dataset.itemId) === itemId);
  });

  let stats = '';
  if (item.damage  > 0) stats += `<div class="item-detail-stat">⚔️ ${item.damage} ${t('game.js.dmg_unit')}</div>`;
  if (item.defense > 0) stats += `<div class="item-detail-stat">🛡️ ${item.defense} ${t('game.js.def_unit')}</div>`;

  let buffLine = '';
  if (item.item_subtype === 'adventure_potion' && item.buff_effect) {
    try {
      const b = JSON.parse(item.buff_effect);
      const BUFF_LABELS = {
        speed:         '⚡ −30% dungeon time',
        loot_quality:  '🍀 Improved loot quality',
        loot_count:    '🎁 +2 extra loot items',
        stamina:       '💚 +1 stamina on completion',
        xp_multiplier: '📚 ×2 XP gain',
      };
      if (BUFF_LABELS[b.type]) buffLine = `<div class="item-detail-buff">${BUFF_LABELS[b.type]}</div>`;
    } catch { /* ignore */ }
  }

  const panel = document.getElementById('buy-detail-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="item-detail-panel">
      <div class="item-detail-header">
        ${itemIconHtml(item.id, item.icon, tItemName(item), charState?.gender, 'item-detail-icon-img')}
        <div>
          <div class="item-detail-name">${escHtml(tItemName(item))}</div>
          <div class="item-detail-type">${tItemType(item)}</div>
        </div>
      </div>
      <div class="item-detail-meta">🪙 ${price}g</div>
      ${stats}
      ${buffLine}
      <div class="item-detail-actions">
        ${canAfford
          ? `<button type="button" class="btn btn-primary btn-sm" onclick="buyItem(${item.id},1)">${t('game.js.buy_btn')}</button>`
          : `<span class="item-detail-cant-afford">${t('game.js.cant_afford')}</span>`}
        <button type="button" class="btn btn-outline btn-sm" onclick="clearBuySelection()">${t('game.js.cancel_btn')}</button>
      </div>
    </div>`;
}

function clearBuySelection() {
  selectedBuyItemId = null;
  document.querySelectorAll('#market-shop-list .market-cell').forEach(c => c.classList.remove('selected'));
  const panel = document.getElementById('buy-detail-panel');
  if (panel) panel.innerHTML = '';
}

async function sellItem(invId, itemId, qty) {
  const res = await api.post(`/api/market/${charId}/sell`, { inv_id: invId, quantity: qty });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.cant_sell'), 'danger'); return; }
  charState = data.char;
  renderAll(data.char);
  showToast(t('game.js.sold_for', { n: data.gold }), 'success');
}

async function buyItem(itemId, qty) {
  const res = await api.post(`/api/market/${charId}/buy`, { item_id: itemId, quantity: qty });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.cant_buy'), 'danger'); return; }
  charState = data.char;
  renderAll(data.char);
  renderShopPane();
  showToast(t('game.js.bought_for', { n: data.spent }), 'success');
}

// ---- Logout ----
async function logout() {
  await api.post('/api/auth/logout');
  api.clearToken();
  window.location.href = '/index.html';
}

// ---- Toast ----
function showToast(msg, type = '') {
  const tc = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  tc.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────────────────────────────────────
// Solo Dungeon (turn-based combat)
// ──────────────────────────────────────────────────────────────────────────────

let soloMonsters       = [];
let soloMonsterIndex   = 0;
let soloTurnInterval   = null;
let soloBattleActive   = false;
let soloBattleHeroMaxHp   = 20;
let soloBattleMonsterMaxHp = 30;

function handleDungeonSolo() {
  if (!charState) return;
  if (farmEndsAt) return;
  if (charState.activity === 'dungeon_solo') {
    openSoloBattlePanel(charState.soloBattle, charState);
    return;
  }
  if (charState.activity) return;
  openSoloDungeonModal();
}

async function openSoloDungeonModal() {
  const res = await api.get(`/api/solo/${charId}/monsters`);
  if (!res) return;
  const data = await res.json();
  soloMonsters = data.monsters || [];
  soloMonsterIndex = 0;

  const modal = document.getElementById('solo-dungeon-modal');
  modal.classList.add('open');
  renderSoloMonsterCarousel();
  updateSoloModalHp(data.heroHp, data.heroMaxHp, data.heroStamina);
}

function closeSoloDungeonModal() {
  document.getElementById('solo-dungeon-modal').classList.remove('open');
}

function renderSoloMonsterCarousel() {
  if (!soloMonsters.length) return;
  const m = soloMonsters[soloMonsterIndex];
  const content = document.getElementById('solo-carousel-content');
  content.innerHTML = `
    <div class="solo-monster-card">
      <div class="solo-monster-portrait">${m.image_path ? `<img src="${escHtml(m.image_path)}" alt="${escHtml(m.name)}" class="solo-monster-img" />` : `<span class="monster-icon">${escHtml(m.icon)}</span>`}</div>
      <div class="monster-name" style="text-align:center;margin:0.4rem 0;">${escHtml(m.name)}</div>
      <div class="solo-monster-stats">
        <span>❤️ ${m.hp}</span>
        <span>⚔️ ${m.attack}</span>
        <span>💨 ${m.agility}</span>
        <span>🛡️ ${m.defense}</span>
      </div>
      <div class="solo-xp-hint">🏆 ${m.xp_reward} XP</div>
    </div>`;
  document.getElementById('solo-carousel-prev').disabled = soloMonsterIndex === 0;
  document.getElementById('solo-carousel-next').disabled = soloMonsterIndex === soloMonsters.length - 1;
  document.getElementById('solo-stamina-cost').textContent = `Costs ${m.stamina_cost} Stamina`;
  const st = Number(charState?.stamina) || 0;
  const canFight = st >= m.stamina_cost && (Number(charState?.hp) || 0) > 0;
  document.getElementById('solo-fight-btn').disabled = !canFight;
  document.getElementById('solo-stamina-warning').classList.toggle('hidden', canFight);
}

function updateSoloModalHp(hp, maxHp, stamina) {
  const pct = maxHp > 0 ? Math.min(100, (hp / maxHp) * 100) : 0;
  const fill = document.getElementById('solo-modal-hp-fill');
  if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('low', pct < 30); }
  const txt = document.getElementById('solo-modal-hp-text');
  if (txt) txt.textContent = `${Math.ceil(hp)} / ${maxHp}`;
}

function prevSoloMonster() {
  if (soloMonsterIndex > 0) { soloMonsterIndex--; renderSoloMonsterCarousel(); }
}

function nextSoloMonster() {
  if (soloMonsterIndex < soloMonsters.length - 1) { soloMonsterIndex++; renderSoloMonsterCarousel(); }
}

async function startSoloBattle() {
  if (!soloMonsters.length) return;
  const monster = soloMonsters[soloMonsterIndex];
  closeSoloDungeonModal();

  const res = await api.post(`/api/solo/${charId}/start`, { monster_id: monster.id });
  if (!res || !res.ok) {
    const err = res ? await res.json() : {};
    showToast(err.error || 'Could not start battle', 'danger');
    return;
  }
  const data = await res.json();
  soloBattleActive      = true;
  soloBattleHeroMaxHp   = data.heroMaxHp;
  soloBattleMonsterMaxHp = data.monsterMaxHp;

  openSoloBattlePanel({ monster_name: data.monster.name, monster_icon: data.monster.icon, monster_hp: data.monsterHp, monster_max_hp: data.monsterMaxHp }, { hp: data.heroHp, max_hp: data.heroMaxHp });
  appendSoloLog([{ type: 'log-separator', text: `Battle started against ${data.monster.name}!` }]);
  startSoloTurnLoop();

  // Refresh char state
  const tick = await api.get(`/api/game/${charId}/tick`);
  if (tick) { const d = await tick.json(); charState = d; renderAll(d); }
}

function openSoloBattlePanel(soloBattle, char) {
  const panel = document.getElementById('solo-battle-panel');
  if (!panel) return;
  panel.classList.add('open');

  const name  = soloBattle.monster_name  || '?';
  const icon  = soloBattle.monster_icon  || '👾';
  const monHp = Number(soloBattle.monster_hp)     || 0;
  const monMax = Number(soloBattle.monster_max_hp) || monHp;
  const heroHp  = Number(char.hp) || Number(char.heroHp) || 0;
  const heroMax = Number(char.max_hp) || Number(char.heroMaxHp) || 20;

  soloBattleHeroMaxHp    = heroMax;
  soloBattleMonsterMaxHp = monMax;

  document.getElementById('solo-battle-title').textContent = `⚔️ ${name}`;
  document.getElementById('solo-monster-name').textContent = name;
  document.getElementById('solo-monster-icon').textContent = icon;
  updateSoloBattleBars(heroHp, heroMax, monHp, monMax);
}

function resumeSoloBattle(soloBattle, char) {
  soloBattleActive = true;
  openSoloBattlePanel(soloBattle, char);
  appendSoloLog([{ type: 'log-separator', text: 'Resuming battle…' }]);
  startSoloTurnLoop();
}

function updateSoloBattleBars(heroHp, heroMax, monHp, monMax) {
  const hPct = heroMax > 0 ? Math.min(100, (heroHp / heroMax) * 100) : 0;
  const mPct = monMax  > 0 ? Math.min(100, (monHp  / monMax)  * 100) : 0;
  const hFill = document.getElementById('solo-hero-hp-fill');
  if (hFill) { hFill.style.width = hPct + '%'; hFill.classList.toggle('low', hPct < 30); }
  const mFill = document.getElementById('solo-monster-hp-fill');
  if (mFill) mFill.style.width = mPct + '%';
  const hTxt = document.getElementById('solo-hero-hp-text');
  if (hTxt) hTxt.textContent = `${Math.ceil(heroHp)} / ${heroMax}`;
  const mTxt = document.getElementById('solo-monster-hp-text');
  if (mTxt) mTxt.textContent = `${Math.ceil(monHp)} / ${monMax}`;
}

function appendSoloLog(entries) {
  const log = document.getElementById('solo-battle-log');
  if (!log) return;
  const empty = log.querySelector('.battle-log-empty');
  if (empty) empty.remove();
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = e.type === 'log-separator' ? 'log-fight-sep'
      : e.type === 'hit-player'  ? 'log-hit-player'
      : e.type === 'hit-monster' ? 'log-hit-monster'
      : e.type === 'dodge'       ? 'log-dodge'
      : 'log-miss-player';
    div.textContent = e.type === 'log-separator' ? `— ${e.text} —` : e.text;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

function startSoloTurnLoop() {
  if (soloTurnInterval) clearInterval(soloTurnInterval);
  soloTurnInterval = setInterval(soloTurn, 800);
}

function stopSoloTurnLoop() {
  if (soloTurnInterval) { clearInterval(soloTurnInterval); soloTurnInterval = null; }
}

async function soloTurn() {
  if (!soloBattleActive) { stopSoloTurnLoop(); return; }

  const res = await api.post(`/api/solo/${charId}/turn`, {});
  if (!res || !res.ok) { stopSoloTurnLoop(); return; }
  const data = await res.json();

  appendSoloLog(data.log || []);
  updateSoloBattleBars(
    data.heroHp,    soloBattleHeroMaxHp,
    data.monsterHp, soloBattleMonsterMaxHp,
  );

  if (data.status === 'victory' || data.status === 'defeat') {
    stopSoloTurnLoop();
    soloBattleActive = false;
    if (data.char) { charState = data.char; renderAll(data.char); }
    setTimeout(() => showSoloResult(data), 600);
  }
}

function showSoloResult(data) {
  const victory = data.status === 'victory';
  document.getElementById('solo-result-title').textContent = victory ? '🏆 Victory!' : '💀 Defeat';

  const xpEl = document.getElementById('solo-result-xp');
  xpEl.textContent = victory ? `+${data.xpGained} XP${data.leveled ? ' · Level Up! 🎉' : ''}` : 'No rewards — try again!';

  const lootEl = document.getElementById('solo-result-loot');
  if (victory && data.loot && data.loot.length > 0) {
    lootEl.innerHTML = data.loot.map(i => `<div class="loot-item"><span class="loot-icon">${escHtml(i.icon || '?')}</span><span>${escHtml(i.name)}</span></div>`).join('');
  } else if (victory) {
    lootEl.innerHTML = '<p class="loot-empty">No loot this time.</p>';
  } else {
    lootEl.textContent = '';
  }

  document.getElementById('solo-result-modal').classList.add('open');
}

function closeSoloResultModal() {
  document.getElementById('solo-result-modal').classList.remove('open');
  document.getElementById('solo-battle-panel').classList.remove('open');
  const log = document.getElementById('solo-battle-log');
  if (log) log.innerHTML = '<span class="battle-log-empty">Combat begins…</span>';
}

function closeSoloBattlePanel() {
  if (soloBattleActive) return; // Can't close while battle is running
  document.getElementById('solo-battle-panel').classList.remove('open');
}

async function fleeSoloBattle() {
  stopSoloTurnLoop();
  soloBattleActive = false;
  const res = await api.post(`/api/solo/${charId}/flee`, {});
  if (res) { const d = await res.json(); if (d.char) { charState = d.char; renderAll(d.char); } }
  document.getElementById('solo-battle-panel').classList.remove('open');
  const log = document.getElementById('solo-battle-log');
  if (log) log.innerHTML = '<span class="battle-log-empty">Combat begins…</span>';
  showToast('You fled the dungeon!', 'warn');
}

// ---- Start ----
init();
