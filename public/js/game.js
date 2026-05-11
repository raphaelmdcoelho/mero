// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

// Item image map: item_id → base path (gender suffix + .png appended at runtime)
const ITEM_IMAGES = {
  3: '/items/leather_armor', // Leather Armor
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
    name: 'Forest',
    icon: '/forest_icon_1.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 1,
    masteryCol: 'dungeon_mastery',
    unlockLevel: 1,
    levels: [
      { n: 1, label: 'Easy' },
      { n: 2, label: 'Medium' },
      { n: 3, label: 'Hard' },
    ]
  },
  {
    id: 6,
    name: 'Autumn Harvest',
    icon: '/autum_icon_2.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 6,
    masteryCol: 'dungeon_mastery_s6',
    unlockLevel: 60,
    levels: [
      { n: 1, label: 'Easy' },
      { n: 2, label: 'Medium' },
      { n: 3, label: 'Hard' },
    ]
  },
  {
    id: 7,
    name: 'Murky Swamp',
    icon: '/swamp_icon_3.png',
    fallbackIcon: '/dungeon-icon.png',
    set: 7,
    masteryCol: 'dungeon_mastery_s7',
    unlockLevel: 70,
    levels: [
      { n: 1, label: 'Easy' },
      { n: 2, label: 'Medium' },
      { n: 3, label: 'Hard' },
    ]
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

  if (char.avatar_path) {
    const img = document.getElementById('avatar-img');
    img.src = char.avatar_path;
    img.style.display = 'block';
  }

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
      const pts = Number(char.reading_points_awarded) || 0;
      actLabel.textContent = t('game.js.reading_badge', { mins: minsLeft, pts });
    } else {
      actLabel.textContent = t('game.js.resting_badge');
    }
  } else {
    actBadge.style.display = 'none';
  }

  updateActionSquares(char.activity);

  const farmLock  = document.getElementById('farm-lock-badge');
  const farmStock = document.getElementById('farm-stock-badge');
  const level = Number(char.level) || 1;
  if (level < 3) {
    farmLock.style.display = 'flex';
    farmStock.style.display = 'none';
    if (!char.activity) document.getElementById('sq-farm').classList.add('disabled');
  } else {
    farmLock.style.display = 'none';
    if (!char.activity) document.getElementById('sq-farm').classList.remove('disabled');
    const totalPlants = (char.inventory || [])
      .filter(i => i.item_id === 6 || i.item_id === 7)
      .reduce((s, p) => s + p.quantity, 0);
    if (totalPlants > 0) {
      farmStock.textContent = totalPlants;
      farmStock.style.display = 'flex';
    } else {
      farmStock.style.display = 'none';
    }
  }

  const gold = Number(char.gold) || 0;
  document.getElementById('gold-display').textContent = `🪙 ${gold}g`;

  renderInventory(char);
  renderEquipment(char);
  renderAttributes(char);
  renderFarmPanel();
  renderBattlePanel(char);
  renderMarketPanel(char);
  refreshCombatStats();
  renderEquipOverlay(char);
}

function renderEquipOverlay(char) {
  const overlay = document.getElementById('equip-overlay');
  const armor = char.equippedArmor;
  if (armor) {
    const img = getItemImage(armor.id, char.gender);
    if (img) {
      overlay.src = img;
      overlay.style.display = 'block';
      return;
    }
  }
  overlay.style.display = 'none';
  overlay.src = '';
}

function updateActionSquares(activity) {
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

  if (activity === 'dungeon') {
    dungeon.classList.add('active');
    tavern.classList.add('disabled');
    farm.classList.add('disabled');
    if (read) read.classList.add('disabled');
  } else if (activity === 'tavern') {
    tavern.classList.add('active');
    document.getElementById('tavern-label').textContent = t('game.js.stop_lbl');
    dungeon.classList.add('disabled');
    farm.classList.add('disabled');
    if (read) read.classList.add('disabled');
  } else if (activity === 'farm') {
    farm.classList.add('active');
    dungeon.classList.add('disabled');
    tavern.classList.add('disabled');
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
  if (pickaxe) pickaxe.classList.toggle('mining', !!activity);
}

// ---- Action handlers ----
function handleDungeon() {
  if (!charState) return;
  if (charState.activity === 'dungeon') {
    openPanel('battle');
    return;
  }
  if (charState.activity) return;
  openDungeonModal();
}

function handleTavern() {
  if (!charState) return;
  if (charState.activity === 'tavern') stopActivity();
  else if (!charState.activity) startTavern();
}

async function startTavern() {
  const res = await api.post(`/api/game/${charId}/start`, { action: 'tavern' });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed'), 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast(t('game.js.resting_start'), 'success');
}

async function stopActivity() {
  const res = await api.post(`/api/game/${charId}/stop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_stop'), 'danger'); return; }
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

function renderPotionSelector() {
  const section = document.getElementById('dungeon-potion-section');
  const list    = document.getElementById('potion-slot-list');
  if (!charState) { section.style.display = 'none'; return; }

  const potions = (charState.inventory || []).filter(i => i.item_subtype === 'adventure_potion');
  section.style.display = '';
  if (!potions.length) {
    list.innerHTML = `<p class="potion-empty-msg">No adventure potions to be used</p>`;
    return;
  }

  const noneSelected = selectedPotionItemId === null;
  list.innerHTML = [
    `<button type="button" class="potion-slot${noneSelected ? ' selected' : ''}" onclick="selectPotion(null)">
       <span class="potion-slot-icon">✗</span>
       <span class="potion-slot-name">None</span>
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
        <span class="potion-slot-name">${escHtml(p.name)}</span>
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

function renderDungeonCarousel() {
  const dungeon = DUNGEONS[currentDungeonIndex];
  selectedDungeonSet = dungeon.set;

  const content = document.getElementById('dungeon-carousel-content');
  content.innerHTML = `
    <img class="dungeon-icon-img" src="${dungeon.icon}" alt="${dungeon.name}"
         onerror="this.onerror=null;this.src='${dungeon.fallbackIcon}'">
    <div class="dungeon-carousel-name">${dungeon.name}</div>
  `;

  document.getElementById('carousel-prev').disabled = currentDungeonIndex === 0;
  document.getElementById('carousel-next').disabled = currentDungeonIndex === DUNGEONS.length - 1;
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

  const cost    = DIFFICULTY_COSTS[selectedDifficulty] || 2;
  const stamina = charState ? (Number(charState.stamina) || 0) : 0;
  const warn    = document.getElementById('stamina-warning');
  const enterBtn = document.getElementById('enter-dungeon-btn');

  if (stamina < cost) {
    warn.textContent = `Not enough stamina (need ${cost}, have ${stamina})`;
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

// ---- Battle panel (timer-based) ----
function renderBattlePanel(char) {
  if (!char || !char.dungeonRun) return;
  const run = char.dungeonRun;

  const dungeonInfo = DUNGEONS.find(d => d.set === (Number(run.dungeon_set) || 1)) || DUNGEONS[0];
  document.getElementById('battle-title').textContent = `⚔️ ${dungeonInfo.name} · Lv ${run.dungeon_level}`;
  document.getElementById('dungeon-run-label').textContent = `${dungeonInfo.name} · Level ${run.dungeon_level}`;

  const diff = run.difficulty || 'easy';
  document.getElementById('dungeon-diff-badge').textContent = diff.charAt(0).toUpperCase() + diff.slice(1);

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

function startLocalTimer() {
  if (localTimerInterval) clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (!dungeonEndsAt) return;
    updateTimerDisplay();
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
    forced ? '🏃 Dungeon Stopped' : '🎉 Dungeon Complete!';

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
    lootList.innerHTML = '<div class="loot-item-row"><span style="color:var(--muted);font-size:0.85rem;">No loot this run.</span></div>';
  } else {
    lootList.innerHTML = loot.map(item =>
      `<div class="loot-item-row">
        <span class="loot-item-icon">${item.icon}</span>
        <span class="loot-item-name">${escHtml(item.name)}</span>
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
  farm:       'farm-panel',
  battle:     'battle-panel',
  market:     'market-panel',
};

function openPanel(type) {
  Object.values(PANEL_MAP).forEach(id => document.getElementById(id).classList.remove('open'));
  const panelId = PANEL_MAP[type];
  if (panelId) document.getElementById(panelId).classList.add('open');
  if (type === 'attributes') { pendingAttrs = {}; renderAttributes(charState); refreshCombatStats(); }
  if (type === 'farm')   renderFarmPanel();
  if (type === 'market') { switchMarketTab('sell'); renderMarketPanel(charState); }
  if (type === 'battle') {
    renderBattlePanel(charState);
    if (dungeonEndsAt) updateTimerDisplay();
  }
}

function closePanel(type) {
  const panelId = PANEL_MAP[type];
  if (panelId) document.getElementById(panelId).classList.remove('open');
}

function itemEquipSlot(item) {
  if (!item) return null;
  if (item.type === 'weapon') return 'weapon';
  if (item.type !== 'armor') return null;
  return item.armor_slot === 'shield' ? 'shield' : 'armor';
}

function equippedSlotMap(char) {
  return {
    weapon: char.weapon_id || null,
    armor: char.armor_id || null,
    shield: char.shield_id || null,
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
    if (!item) return `<div class="inv-slot empty" title="Empty">·</div>`;
    const isEq = equippedIds.has(item.item_id);
    return `<div class="inv-slot${isEq ? ' equipped' : ''}" onclick="showItemInfo(${i})" title="${escHtml(item.name)}">
      ${itemIconHtml(item.item_id, item.icon, item.name, gender, 'inv-item-img')}
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
    <strong class="item-tt-name">${item.icon} ${escHtml(item.name)}</strong>
    <span class="item-tt-type">${item.type}${item.weapon_type ? ' · ' + item.weapon_type : ''}</span>
    <p class="item-tt-desc">${escHtml(item.description || '')}${statLine ? ' ' + statLine : ''}</p>
    ${canEquip && !isEq
      ? `<button type="button" class="btn btn-outline btn-sm btn-mt" onclick="equipItem('${slot}',${item.item_id})">${t('game.js.equip_btn')}</button>`
      : ''}
    ${canEquip && isEq
      ? `<span class="item-tt-eq">${t('game.js.equipped_check')}</span>
         <button type="button" class="btn btn-outline btn-sm btn-mt" onclick="unequipItem('${slot}')">${t('game.js.unequip_btn')}</button>`
      : ''}`;
}

// ---- Equipment ----
function renderEquipment(char) {
  if (!char) return;
  const w = char.equippedWeapon;
  const a = char.equippedArmor;
  const s = char.equippedShield;

  document.getElementById('eq-weapon-name').textContent = w ? `${w.icon} ${w.name}` : '—';
  document.getElementById('eq-weapon-stat').textContent =
    w && w.damage ? `⚔️ ${w.damage} ${t('game.js.dmg_unit')} · ${w.weapon_type}` : '';

  document.getElementById('eq-armor-name').textContent = a ? `${a.icon} ${a.name}` : '—';
  document.getElementById('eq-armor-stat').textContent =
    a && a.defense ? `🛡️ ${a.defense} ${t('game.js.def_unit')}` : '';

  document.getElementById('eq-shield-name').textContent = s ? `${s.icon} ${s.name}` : '—';
  document.getElementById('eq-shield-stat').textContent =
    s && s.defense ? `🛡️ ${s.defense} ${t('game.js.def_unit')}` : '';

  document.getElementById('eq-weapon-action').innerHTML =
    w ? `<button type="button" class="btn btn-outline btn-sm" onclick="unequipItem('weapon')">${t('game.js.unequip_btn')}</button>` : '';
  document.getElementById('eq-armor-action').innerHTML =
    a ? `<button type="button" class="btn btn-outline btn-sm" onclick="unequipItem('armor')">${t('game.js.unequip_btn')}</button>` : '';
  document.getElementById('eq-shield-action').innerHTML =
    s ? `<button type="button" class="btn btn-outline btn-sm" onclick="unequipItem('shield')">${t('game.js.unequip_btn')}</button>` : '';

  const inv = (char.inventory || []).filter(i => itemEquipSlot(i));
  const equippedBySlot = equippedSlotMap(char);
  const list = document.getElementById('eq-list');
  if (!inv.length) { list.innerHTML = `<p class="muted-sm">${t('game.js.no_equippable')}</p>`; return; }
  list.innerHTML = inv.map(item => {
    const statLine = item.damage ? `⚔️ ${item.damage} ${t('game.js.dmg_unit')}` : item.defense ? `🛡️ ${item.defense} ${t('game.js.def_unit')}` : '';
    const slot = itemEquipSlot(item);
    const equipped = slot ? equippedBySlot[slot] === item.item_id : false;
    return `
    <div class="equip-list-row">
      <span class="equip-list-icon">${item.icon}</span>
      <span class="equip-list-name">
        ${escHtml(item.name)}
        <span class="equip-list-type">${item.type}${item.weapon_type ? ' · ' + item.weapon_type : ''}${item.armor_slot ? ' · ' + item.armor_slot : ''}</span>
        ${statLine ? `<span class="equip-list-type"> · ${statLine}</span>` : ''}
      </span>
      ${equipped
        ? `<button type="button" class="btn btn-outline btn-sm" onclick="unequipItem('${slot}')">${t('game.js.unequip_btn')}</button>`
        : `<button type="button" class="btn btn-outline btn-sm" onclick="equipItem('${slot}',${item.item_id})">${t('game.js.equip_btn')}</button>`}
    </div>`;
  }).join('');
}

async function equipItem(slot, itemId) {
  const res = await api.put(`/api/characters/${charId}/equip`, { slot, item_id: itemId });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.cant_equip'), 'danger'); return; }
  charState = { ...charState, ...data };
  renderEquipment(charState);
  renderInventory(charState);
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

// ---- Read ----
async function startActivity(action) {
  const res = await api.post(`/api/game/${charId}/start`, { action });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed'), 'danger'); return; }
  charState = data;
  renderAll(data);
}

function handleRead() {
  if (!charState) return;
  if (charState.activity === 'reading') {
    stopActivity();
  } else if (!charState.activity) {
    startActivity('reading');
    showToast(t('game.js.reading_start'), 'success');
  }
}

// ---- Farm ----
function handleFarm() {
  if (!charState) return;
  if (Number(charState.level) < 3) { showToast(t('game.js.farm_unlock'), 'danger'); return; }
  openPanel('farm');
}

async function startFarmActivity() {
  const res = await api.post(`/api/game/${charId}/start`, { action: 'farm' });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_farm'), 'danger'); return; }
  charState = data;
  renderAll(data);
  openPanel('farm');
  showToast(t('game.js.farm_started'), 'success');
}

async function stopFarmActivity() {
  if (!charState || charState.activity !== 'farm') return;
  await stopActivity();
  openPanel('farm');
}

async function toggleFarmActivity() {
  if (!charState) return;
  const level = Number(charState.level) || 1;
  if (level < 3) { showToast(t('game.js.farm_unlock'), 'danger'); return; }

  if (charState.activity === 'farm') {
    await stopFarmActivity();
    return;
  }
  if (charState.activity) {
    showToast(t('game.fp.busy_other_activity'), 'warn');
    return;
  }
  await startFarmActivity();
}

async function startGrowing(plantType) {
  const res = await api.post(`/api/farm/${charId}/grow`, { plant_type: plantType });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_grow'), 'danger'); return; }
  const icon = plantType === 'carrot' ? '🥕' : '🍎';
  const plantName = plantType.charAt(0).toUpperCase() + plantType.slice(1);
  showToast(t('game.js.plant_planted', { icon, plant: plantName }), 'success');
  charState = { ...charState, farmQueue: data.farmQueue };
  renderAll(charState);
}

function renderFarmPanel() {
  const char = charState;
  if (!char) return;
  const now = Math.floor(Date.now() / 1000);
  const level = Number(char.level) || 1;

  const activityStatusEl = document.getElementById('farm-activity-status');
  const activityBtnEl = document.getElementById('farm-activity-btn');
  if (level < 3) {
    activityStatusEl.textContent = t('game.js.farm_unlock');
    activityBtnEl.textContent = t('game.fp.start_action');
    activityBtnEl.disabled = true;
  } else if (char.activity === 'farm') {
    activityStatusEl.textContent = t('game.fp.running_status');
    activityBtnEl.textContent = t('game.fp.stop_action');
    activityBtnEl.disabled = false;
  } else if (char.activity) {
    activityStatusEl.textContent = t('game.fp.busy_other_activity');
    activityBtnEl.textContent = t('game.fp.start_action');
    activityBtnEl.disabled = true;
  } else {
    activityStatusEl.textContent = t('game.fp.idle_status');
    activityBtnEl.textContent = t('game.fp.start_action');
    activityBtnEl.disabled = false;
  }

  const stockList = document.getElementById('farm-stock-list');
  const plants = (char.inventory || []).filter(i => i.item_id === 6 || i.item_id === 7);
  if (!plants.length) {
    stockList.innerHTML = `<span style="font-size:0.8rem;color:var(--muted);">${t('game.js.nothing_harvested')}</span>`;
  } else {
    stockList.innerHTML = plants.map(p => {
      const hp = p.item_id === 6 ? 2 : 1;
      return `<div style="text-align:center;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.5rem 0.75rem;">
        <div style="font-size:1.3rem;">${p.icon}</div>
        <div style="font-size:0.75rem;font-weight:600;">${escHtml(p.name)}</div>
        <div style="font-size:0.7rem;color:var(--muted);">×${p.quantity} &bull; +${hp} HP</div>
      </div>`;
    }).join('');
  }

  const queueList = document.getElementById('farm-queue-list');
  const queue = char.farmQueue || [];
  if (!queue.length) {
    queueList.innerHTML = `<span style="font-size:0.8rem;color:var(--muted);">${t('game.js.no_plants_growing')}</span>`;
  } else {
    queueList.innerHTML = queue.map(job => {
      const icon     = job.plant_type === 'carrot' ? '🥕' : '🍎';
      const secsLeft = Number.isFinite(Number(job.remaining_seconds))
        ? Math.max(0, Number(job.remaining_seconds))
        : Math.max(0, (Number(job.ready_at) || 0) - now);
      const mins     = Math.floor(secsLeft / 60);
      const secs     = secsLeft % 60;
      const timeStr  = secsLeft === 0 ? t('game.js.ready') : `${mins}m ${String(secs).padStart(2,'0')}s`;
      return `<div style="display:flex;align-items:center;gap:0.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.4rem 0.6rem;margin-bottom:0.35rem;">
        <span style="font-size:1.1rem;">${icon}</span>
        <span style="font-size:0.8rem;flex:1;">${job.plant_type}</span>
        <span style="font-size:0.75rem;color:var(--muted);">${timeStr}</span>
      </div>`;
    }).join('');
  }
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
      <div class="market-tooltip-name">${escHtml(item.name)}</div>
      <div class="market-tooltip-meta">
        ${t('game.js.qty')}: ${item.quantity}<br>
        <span class="market-tooltip-price">🪙 ${price}g ${t('game.js.each')}</span>
      </div>
      ${equipped
        ? `<div class="market-tooltip-equipped">${t('game.js.equipped_tag')}</div>`
        : `<span class="market-tooltip-sell">${t('game.js.click_to_sell')}</span>`}`;
    return `
      <div class="market-cell${equipped ? ' equipped' : ''}" ${clickAttr} data-tip="${escHtml(tipHtml)}">
        ${itemIconHtml(item.item_id, item.icon, item.name, gender, 'market-item-img')}
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
      <div class="market-tooltip-name">${escHtml(item.name)}</div>
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
        ${itemIconHtml(item.id, item.icon, item.name, gender, 'market-item-img')}
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
