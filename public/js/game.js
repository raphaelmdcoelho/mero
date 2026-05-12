// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

// Item image map: item_id → base path (gender suffix + .png appended at runtime)
const ITEM_IMAGES = {
  3:  '/items/leather_armor', // Leather Armor
  15: '/items/hunter_armor',  // Hunter Armor
};

function getItemImage(itemId, gender) {
  const base = ITEM_IMAGES[Number(itemId)];
  if (!base) return null;
  return `${base}_${gender || 'male'}.png`;
}

function itemIconHtml(itemId, itemIcon, itemName, gender, imgClass) {
  const img = getItemImage(itemId, gender);
  if (img) return `<img class="${imgClass}" src="${img}" alt="${escHtml(itemName)}" />`;
  return itemIcon || '?';
}

const ATTRS = [
  { key: 'strength',      labelKey: 'attr.strength',      icon: '⚔️',  hintKey: 'attr.strength_hint' },
  { key: 'dexterity',     labelKey: 'attr.dexterity',     icon: '🏹',  hintKey: 'attr.dexterity_hint' },
  { key: 'agility',       labelKey: 'attr.agility',       icon: '💨',  hintKey: 'attr.agility_hint' },
  { key: 'vitality',      labelKey: 'attr.vitality',      icon: '❤️',  hintKey: 'attr.vitality_hint' },
  { key: 'intelligence',  labelKey: 'attr.intelligence',  icon: '🔮',  hintKey: 'attr.intelligence_hint' },
  { key: 'focus',         labelKey: 'attr.focus',         icon: '🎯',  hintKey: 'attr.focus_hint' },
  { key: 'stamina',    labelKey: 'attr.stamina',    icon: '⚡', hintKey: 'attr.stamina_hint' },
  { key: 'resistance', labelKey: 'attr.resistance', icon: '🌀', hintKey: 'attr.resistance_hint' },
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
    const readFill = document.getElementById('read-progress-fill');
    if (readFill) readFill.style.width = '0%';
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
  const overlayImg = char.equippedArmor ? getItemImage(char.equippedArmor.id, char.gender) : null;
  const overlay = overlayImg ? `<img class="equip-overlay" src="${escHtml(overlayImg)}" alt="" />` : '';
  if (char.avatar_path) {
    containerEl.innerHTML = `<img class="char-avatar-img" src="${escHtml(char.avatar_path)}" alt="Avatar" />${overlay}`;
  } else {
    const icon = CLASS_ICONS[char.class] || '🧍';
    containerEl.innerHTML = `<span class="char-avatar-icon">${icon}</span>${overlay}`;
  }
}

function updateActionSquares(activity, isFarming = false) {
  const dungeon = document.getElementById('sq-dungeon');
  const farm    = document.getElementById('sq-farm');
  const tavern  = document.getElementById('sq-tavern');
  const inv     = document.getElementById('sq-inventory');
  const eq      = document.getElementById('sq-equipment');
  const attrs   = document.getElementById('sq-attributes');
  const stats   = document.getElementById('sq-stats');
  const read    = document.getElementById('sq-read');

  const resetEls = [dungeon, farm, tavern, inv, eq, attrs, stats, read].filter(Boolean);
  resetEls.forEach(el => el.classList.remove('active', 'disabled'));

  document.getElementById('dungeon-label').textContent = t('game.js.dungeon_lbl');
  document.getElementById('tavern-label').textContent  = t('game.js.tavern_lbl');
  document.getElementById('farm-label').textContent    = t('game.js.farm_lbl');
  if (read) document.getElementById('read-label').textContent = t('game.js.read_lbl');

  if (isFarming) {
    dungeon.classList.add('disabled');
    tavern.classList.add('disabled');
    if (read) read.classList.add('disabled');
  } else if (activity === 'dungeon') {
    dungeon.classList.add('active');
    tavern.classList.add('disabled');
    if (read) read.classList.add('disabled');
  } else if (activity === 'tavern') {
    tavern.classList.add('active');
    document.getElementById('tavern-label').textContent = t('game.js.stop_lbl');
    dungeon.classList.add('disabled');
    farm.classList.add('disabled');
    if (read) read.classList.add('disabled');
  } else if (activity === 'reading') {
    if (read) {
      read.classList.add('active');
      document.getElementById('read-label').textContent = t('game.js.stop_lbl');
    }
    dungeon.classList.add('disabled');
    tavern.classList.add('disabled');
    farm.classList.add('disabled');
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

function openTavernModal() {
  const gold = Number(charState?.gold) || 0;
  const REST_TYPES = [
    { key: 'relax',    cost: 10, nameKey: 'tavern.rest.relax',    descKey: 'tavern.rest.relax_desc' },
    { key: 'break',    cost: 30, nameKey: 'tavern.rest.break',    descKey: 'tavern.rest.break_desc' },
    { key: 'recovery', cost: 70, nameKey: 'tavern.rest.recovery', descKey: 'tavern.rest.recovery_desc' },
  ];
  const container = document.getElementById('tavern-rest-options');
  container.innerHTML = REST_TYPES.map(r => {
    const canAfford = gold >= r.cost;
    return `<div class="tavern-rest-card${canAfford ? '' : ' disabled'}"
                 ${canAfford ? `onclick="startTavernRest('${r.key}')"` : ''}>
      <div class="tavern-rest-card-info">
        <span class="tavern-rest-card-name">${t(r.nameKey)}</span>
        <span class="tavern-rest-card-desc">${t(r.descKey)}</span>
      </div>
      <span class="tavern-rest-card-cost">🪙 ${r.cost}g</span>
    </div>`;
  }).join('');
  document.getElementById('tavern-modal').classList.add('open');
}

function closeTavernModal() {
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
  const tavernFill = document.getElementById('tavern-progress-fill');
  if (tavernFill) tavernFill.style.width = '0%';
  const readFill = document.getElementById('read-progress-fill');
  if (readFill) readFill.style.width = '0%';
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
  const fill = document.getElementById('tavern-progress-fill');
  if (!fill) return;
  if (!tavernStartedAt) { fill.style.width = '0%'; return; }
  const elapsedSec = (Date.now() - tavernStartedAt) / 1000;
  fill.style.width = Math.min(100, (elapsedSec / 300) * 100) + '%';
}

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (dungeonEndsAt) updateTimerDisplay();
    updateTavernProgressBar();
    updateReadProgressBar();
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
        <span class="loot-item-icon">${item.icon}</span>
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
  const panel = document.getElementById('attr-panel');
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
  attributes: 'attr-panel',
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

const MAX_INVENTORY_SLOTS = 25;

// ---- Inventory ----
function renderInventory(char) {
  if (!char) return;
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
}

function showItemInfo(idx) {
  if (!charState) return;
  const item = (charState.inventory || [])[idx];
  const tooltip = document.getElementById('item-tooltip');
  if (!item) { tooltip.style.display = 'none'; return; }
  const slot = itemEquipSlot(item);
  const equipMap = equippedSlotMap(charState);
  const isEq = slot ? equipMap[slot] === item.item_id : false;
  const canEquip = slot !== null;
  const statLine = item.damage ? `⚔️ ${item.damage} ${t('game.js.dmg_unit')}` : item.defense ? `🛡️ ${item.defense} ${t('game.js.def_unit')}` : '';
  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <strong class="item-tt-name">${item.icon} ${escHtml(tItemName(item))}</strong>
    <span class="item-tt-type">${tItemType(item)}</span>
    <p class="item-tt-desc">${escHtml(tItemDesc(item))}${statLine ? ' ' + statLine : ''}</p>
    ${canEquip && !isEq
      ? `<button type="button" class="btn btn-outline btn-sm btn-mt" onclick="equipItem('${slot}',${item.item_id})">${t('game.js.equip_btn')}</button>`
      : ''}
    ${canEquip && isEq
      ? `<span class="item-tt-eq">${t('game.js.equipped_check')}</span>
         <button type="button" class="btn btn-outline btn-sm btn-mt" onclick="unequipItem('${slot}')">${t('game.js.unequip_btn')}</button>`
      : ''}`;
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
               onclick="eqInvSlotClick(${idx})">
      ${itemIconHtml(item.item_id, item.icon, tItemName(item), gender, 'inv-item-img')}
    </div>`;
  }).join('');

  _eqAttachDragListeners(char);
}

function eqInvSlotClick(idx) {
  if (!charState) return;
  const inv = (charState.inventory || []).filter(i => itemEquipSlot(i));
  const item = inv[idx];
  if (!item) return;
  const slot = itemEquipSlot(item);
  const equippedBySlot = equippedSlotMap(charState);
  if (equippedBySlot[slot] === item.item_id) {
    unequipItem(slot);
  } else {
    equipItem(slot, item.item_id);
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
  list.innerHTML = ATTRS.map(({ key, labelKey, icon, hintKey }) => {
    const base  = Number(char[`attr_${key}`]) || 5;
    const delta = pendingAttrs[key] || 0;
    const label = t(labelKey) || key;
    const hint  = t(hintKey)  || '';
    return `
      <div class="attr-row">
        <span class="attr-icon">${icon}</span>
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
  const fill = document.getElementById('read-progress-fill');
  if (!fill) return;
  if (!readStartedAt) { fill.style.width = '0%'; return; }
  const elapsedSec = (Date.now() - readStartedAt) / 1000;
  fill.style.width = Math.min(100, (elapsedSec / 3600) * 100) + '%';
}

document.getElementById('read-modal').addEventListener('click', function(e) {
  if (e.target === this) closeReadModal();
});

const FARM_PLANTS = [
  { type: 'carrot', label: 'Carrot', img: '/img/carrot.png' },
  { type: 'apple',  label: 'Apple',  img: '/img/apple.png'  },
  { type: 'onion',  label: 'Onion',  img: '/img/onion.png'  },
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

function switchMarketTab(tab) {
  marketTab = tab;
  document.getElementById('market-tab-sell').classList.toggle('active', tab === 'sell');
  document.getElementById('market-tab-buy').classList.toggle('active', tab === 'buy');
  document.getElementById('market-sell-pane').style.display = tab === 'sell' ? '' : 'none';
  document.getElementById('market-buy-pane').style.display  = tab === 'buy'  ? '' : 'none';
  if (tab === 'buy') renderShopPane();
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
  const gold = Number(char.gold) || 0;
  document.getElementById('market-gold-amount').textContent = `🪙 ${gold}g`;

  const equippedIds = new Set([char.weapon_id, char.armor_id, char.shield_id].filter(Boolean));
  const sellable = (char.inventory || []).filter(i => Number(i.sell_price) > 0);
  const list = document.getElementById('market-list');

  if (!sellable.length) {
    list.innerHTML = `<p class="muted-sm">${t('game.js.nothing_to_sell')}</p>`;
    return;
  }

  const gender = char.gender || 'male';
  list.innerHTML = `<div class="market-grid">${sellable.map(item => {
    const equipped  = equippedIds.has(item.item_id);
    const price     = Number(item.sell_price);
    const qtyLabel  = item.quantity > 1 ? `×${item.quantity}` : '';
    const clickAttr = equipped ? '' : `onclick="sellItem(${item.id},${item.item_id},1)"`;
    const tipHtml   = `
      <div class="market-tooltip-name">${escHtml(tItemName(item))}</div>
      <div class="market-tooltip-meta">
        ${t('game.js.qty')}: ${item.quantity}<br>
        <span class="market-tooltip-price">🪙 ${price}g ${t('game.js.each')}</span>
      </div>
      ${equipped
        ? `<div class="market-tooltip-equipped">${t('game.js.equipped_tag')}</div>`
        : `<span class="market-tooltip-sell">${t('game.js.click_to_sell')}</span>`}`;
    return `
      <div class="market-cell${equipped ? ' equipped' : ''}" ${clickAttr} data-tip="${escHtml(tipHtml)}">
        ${itemIconHtml(item.item_id, item.icon, tItemName(item), gender, 'market-item-img')}
        ${qtyLabel ? `<span class="market-cell-qty">${qtyLabel}</span>` : ''}
      </div>`;
  }).join('')}</div>`;

  attachMarketTooltip(list, cell => cell.dataset.tip || '');
}

async function renderShopPane() {
  const shopList = document.getElementById('market-shop-list');
  shopList.innerHTML = `<p class="muted-sm">${t('game.js.loading')}</p>`;
  const res = await api.get(`/api/market/${charId}/shop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { shopList.innerHTML = `<p class="muted-sm">${data.error}</p>`; return; }

  const items = data.items || [];
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
    const clickAttr = canAfford ? `onclick="buyItem(${item.id},1)"` : '';
    return `
      <div class="market-cell${canAfford ? '' : ' cant-afford'}" ${clickAttr} data-tip="${escHtml(tipHtml)}">
        ${itemIconHtml(item.id, item.icon, tItemName(item), gender, 'market-item-img')}
      </div>`;
  }).join('')}</div>`;

  attachMarketTooltip(shopList, cell => cell.dataset.tip || '');
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

// ---- Start ----
init();
