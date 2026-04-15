// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

const ATTRS = [
  { key: 'strength',     labelKey: 'attr.strength',     icon: '⚔️',  hintKey: 'attr.strength_hint' },
  { key: 'dexterity',    labelKey: 'attr.dexterity',    icon: '🏹',  hintKey: 'attr.dexterity_hint' },
  { key: 'agility',      labelKey: 'attr.agility',      icon: '💨',  hintKey: 'attr.agility_hint' },
  { key: 'vitality',     labelKey: 'attr.vitality',     icon: '❤️',  hintKey: 'attr.vitality_hint' },
  { key: 'intelligence', labelKey: 'attr.intelligence', icon: '🔮',  hintKey: 'attr.intelligence_hint' },
  { key: 'focus',        labelKey: 'attr.focus',        icon: '🎯',  hintKey: 'attr.focus_hint' },
  { key: 'stamina',      labelKey: 'attr.stamina',      icon: '🛡️',  hintKey: 'attr.stamina_hint' },
  { key: 'resistance',   labelKey: 'attr.resistance',   icon: '🌀',  hintKey: 'attr.resistance_hint' },
];

const DUNGEON_LEVEL_ICONS = ['','🌿','🪨','💀','🌑','🔥','🧊','⚡','🌊','☠️','🐉'];

const DUNGEON_SETS = [
  { set: 1, icon: '🌿', nameKey: 'dungeon.set1', unlockLevel: 1,  masteryCol: 'dungeon_mastery' },
  { set: 2, icon: '🌋', nameKey: 'dungeon.set2', unlockLevel: 20, masteryCol: 'dungeon_mastery_s2' },
  { set: 3, icon: '🧊', nameKey: 'dungeon.set3', unlockLevel: 30, masteryCol: 'dungeon_mastery_s3' },
  { set: 4, icon: '⚡', nameKey: 'dungeon.set4', unlockLevel: 40, masteryCol: 'dungeon_mastery_s4' },
  { set: 5, icon: '🌑', nameKey: 'dungeon.set5', unlockLevel: 50, masteryCol: 'dungeon_mastery_s5' },
];

let charState  = null;
let tickInterval = null;
let pendingAttrs = {};
let selectedDungeonLevel = 1;
let selectedDungeonSet   = 1;

// ---- Init ----
async function init() {
  const res = await api.get(`/api/game/${charId}/tick`);
  if (!res) return;
  const data = await res.json();
  charState = data;
  renderAll(data);
  startTick();
}

// ---- Tick (tavern HP regen + farm harvest) ----
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
    img.src = char.avatar_path + '?t=' + Date.now();
    img.style.display = 'block';
    document.getElementById('avatar-svg').style.display = 'none';
  }

  const xpPct = char.xp_to_next > 0 ? Math.min(100, (char.xp / char.xp_to_next) * 100) : 100;
  document.getElementById('xp-fill').style.width = xpPct + '%';
  document.getElementById('xp-text').textContent = `${Math.floor(char.xp)} / ${char.xp_to_next}`;

  const hp    = Math.max(0, char.hp);
  const hpPct = char.max_hp > 0 ? Math.min(100, (hp / char.max_hp) * 100) : 0;
  const hpFill = document.getElementById('hp-fill');
  hpFill.style.width = hpPct + '%';
  hpFill.className = 'stat-fill hp' + (hpPct < 30 ? ' low' : '');
  document.getElementById('hp-text').textContent = `${Math.round(hp * 10) / 10} / ${char.max_hp}`;

  document.getElementById('level-display').textContent = t('game.js.level', { n: char.level });

  const unspent = Number(char.unspent_points) || 0;
  const badge  = document.getElementById('unspent-badge');
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
    // also disable if not already handled by updateActionSquares
    if (!char.activity) document.getElementById('sq-farm').classList.add('disabled');
  } else {
    farmLock.style.display = 'none';
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

  // Gold display
  const gold = Number(char.gold) || 0;
  document.getElementById('gold-display').textContent = `🪙 ${gold}g`;

  renderInventory(char);
  renderEquipment(char);
  renderAttributes(char);
  renderFarmPanel();
  renderBattlePanel(char);
  renderMarketPanel(char);
  refreshCombatStats();
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

  // Reset activity squares (farm handled separately below)
  const resetEls = [dungeon, tavern, inv, eq, attrs, stats, read].filter(Boolean);
  resetEls.forEach(el => el.classList.remove('active', 'disabled'));

  if (activity === 'dungeon') {
    dungeon.classList.add('active');
    document.getElementById('dungeon-label').textContent = t('game.js.dungeon_lbl');
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
    document.getElementById('farm-label').textContent = t('game.js.stop_farm_lbl');
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
  } else {
    document.getElementById('dungeon-label').textContent = t('game.js.dungeon_lbl');
    document.getElementById('tavern-label').textContent  = t('game.js.tavern_lbl');
    document.getElementById('farm-label').textContent    = t('game.js.farm_lbl');
    if (read) document.getElementById('read-label').textContent = t('game.js.read_lbl');
  }
}

// ---- Action handlers ----
function handleDungeon() {
  if (!charState) return;
  if (charState.activity === 'dungeon') {
    openPanel('battle'); // openPanel will call startAutoBattle if not running
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

// ---- Dungeon level modal ----
function openDungeonModal() {
  const charLevel = Number(charState.level) || 1;

  // Ensure selectedDungeonSet is accessible for this character
  if ((DUNGEON_SETS.find(s => s.set === selectedDungeonSet) || {}).unlockLevel > charLevel) {
    selectedDungeonSet = 1;
  }

  // Build set tabs
  const tabsEl = document.getElementById('dungeon-set-tabs');
  tabsEl.innerHTML = '';
  DUNGEON_SETS.forEach(s => {
    const unlocked = charLevel >= s.unlockLevel;
    const btn = document.createElement('button');
    btn.className = 'dungeon-set-tab' +
      (s.set === selectedDungeonSet ? ' active' : '') +
      (!unlocked ? ' locked' : '');
    btn.disabled = !unlocked;
    btn.dataset.set = s.set;
    btn.title = unlocked ? '' : t('dungeon.set_locked', { n: s.unlockLevel });
    btn.innerHTML = `${s.icon} <span>${t(s.nameKey)}</span>`;
    if (unlocked) btn.onclick = () => selectDungeonSet(s.set);
    tabsEl.appendChild(btn);
  });

  renderDungeonLevelGrid();
  document.getElementById('dungeon-modal').classList.add('open');
}

function renderDungeonLevelGrid() {
  const setInfo = DUNGEON_SETS.find(s => s.set === selectedDungeonSet);
  const mastery = Number(charState[setInfo.masteryCol]) || 0;
  const grid    = document.getElementById('dungeon-level-grid');
  grid.innerHTML = '';
  selectedDungeonLevel = Math.min(mastery + 1, 10);

  for (let lvl = 1; lvl <= 10; lvl++) {
    const unlocked = lvl <= mastery + 1;
    const selected = lvl === selectedDungeonLevel;
    const completed = lvl <= mastery;
    const card = document.createElement('div');
    card.className = 'dungeon-level-card' +
      (selected ? ' selected' : '') +
      (!unlocked ? ' locked' : '');
    card.dataset.level = lvl;
    card.innerHTML = `
      <div class="dl-icon">${DUNGEON_LEVEL_ICONS[lvl]}</div>
      <div class="dl-num">${lvl}</div>
      ${completed ? '<div class="dl-mastery">✓</div>' : ''}
    `;
    if (unlocked) card.onclick = () => selectDungeonLevel(card, lvl);
    grid.appendChild(card);
  }
}

function selectDungeonSet(set) {
  selectedDungeonSet = set;
  document.querySelectorAll('.dungeon-set-tab').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.set) === set);
  });
  renderDungeonLevelGrid();
}

function closeDungeonModal() {
  document.getElementById('dungeon-modal').classList.remove('open');
}

function selectDungeonLevel(el, lvl) {
  document.querySelectorAll('.dungeon-level-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedDungeonLevel = lvl;
}

async function confirmEnterDungeon() {
  closeDungeonModal();
  const res = await api.post(`/api/game/${charId}/dungeon/enter`, { level: selectedDungeonLevel, set: selectedDungeonSet });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_dungeon'), 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast(t('game.js.entered_dungeon', { n: selectedDungeonLevel }), 'success');
  openPanel('battle');
  startAutoBattle();
}

document.getElementById('dungeon-modal').addEventListener('click', function(e) {
  if (e.target === this) closeDungeonModal();
});

// ---- Battle panel ----
function renderBattlePanel(char) {
  if (!char || !char.dungeonRun) return;
  const run     = char.dungeonRun;
  const monster = run.monster;
  if (!monster) return;

  const dungeonSetInfo = DUNGEON_SETS.find(s => s.set === (Number(run.dungeon_set) || 1)) || DUNGEON_SETS[0];
  document.getElementById('battle-title').textContent =
    t('game.js.bl.mastery', { level: run.dungeon_level, mastery: char[dungeonSetInfo.masteryCol] || 0 });

  const isBoss = monster.is_boss === 1;
  document.getElementById('battle-kills-label').textContent = t('game.js.bl.monsters', { kills: run.kills });
  document.getElementById('battle-boss-label').style.display = isBoss ? 'inline' : 'none';

  document.getElementById('monster-icon').textContent = monster.icon;
  document.getElementById('monster-name').textContent = (isBoss ? t('game.js.bl.boss_prefix') : '') + monster.name;

  setMonsterHpBar(run.monster_hp, monster.hp);
  setHeroHpBar(char.hp, char.max_hp);
}

function setMonsterHpBar(current, max) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  document.getElementById('monster-hp-fill').style.width = pct + '%';
  document.getElementById('monster-hp-text').textContent = `${Math.max(0, Math.round(current))} / ${max}`;
}

function setHeroHpBar(current, max) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  const fill = document.getElementById('battle-hero-hp-fill');
  fill.style.width = pct + '%';
  fill.className   = 'stat-fill hp' + (pct < 30 ? ' low' : '');
  document.getElementById('battle-hero-hp-text').textContent =
    `${Math.max(0, Math.round(current * 10) / 10)} / ${max}`;
}

// ---- Auto-battle loop ----
let autoBattleRunning = false;
let autoBattleStop    = false;

async function startAutoBattle() {
  if (autoBattleRunning) return;
  autoBattleRunning = true;
  autoBattleStop    = false;

  // Clear log for new run
  const container = document.getElementById('battle-log');
  container.innerHTML = '';

  while (!autoBattleStop) {
    // --- call the server for one monster fight ---
    const res = await api.post(`/api/game/${charId}/dungeon/attack`);
    if (!res || autoBattleStop) break;

    const data = await res.json();
    if (!res.ok) { showToast(data.error || t('game.js.battle_error'), 'danger'); break; }

    // Snapshot pre-fight state for animation
    const prevMonsterHp  = charState.dungeonRun ? Number(charState.dungeonRun.monster_hp) : 0;
    const prevMonsterMax = charState.dungeonRun ? charState.dungeonRun.monster.hp : 1;
    const monsterName    = charState.dungeonRun ? charState.dungeonRun.monster.name : 'Monster';
    const prevHeroHp     = Number(charState.hp);
    const heroMax        = Number(charState.max_hp);

    await animateCombatLog(
      data.combatLog, monsterName,
      prevMonsterHp, prevMonsterMax,
      prevHeroHp, heroMax,
      data.char.dungeonRun ? Number(data.char.dungeonRun.monster_hp) : 0,
      Number(data.char.hp)
    );

    charState = data.char;
    renderAll(data.char);

    if (data.result === 'defeat') {
      showToast(t('game.js.hero_fallen_msg'), 'danger');
      closePanel('battle');
      break;
    }

    if (data.result === 'run_complete') {
      showToast(t('game.js.boss_defeated', { n: data.newMastery }), 'success');
      if (data.droppedItem) showToast(t('game.js.item_dropped', { icon: data.droppedItem.icon, name: data.droppedItem.name }), 'success');
      closePanel('battle');
      break;
    }

    if (data.result === 'monster_killed') {
      if (data.droppedItem) showToast(t('game.js.item_dropped', { icon: data.droppedItem.icon, name: data.droppedItem.name }), 'success');
      if (data.bossSpawned) showToast(t('game.js.boss_spawned'), 'warn');
    }

    // Pause between fights so the log stays readable (extra 1s after each kill)
    if (!autoBattleStop) await sleep(2500);
  }

  autoBattleRunning = false;
}

async function stopDungeon() {
  autoBattleStop = true;
  const res = await api.post(`/api/game/${charId}/dungeon/flee`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed', 'danger'); return; }
  charState = data;
  renderAll(data);
  closePanel('battle');
  showToast(t('game.js.left_dungeon'), 'warn');
}

// Replay each round with a delay, updating HP bars live
async function animateCombatLog(
  log, monsterName,
  monsterHp, monsterMax,
  heroHp, heroMax,
  finalMonsterHp, finalHeroHp
) {
  const container = document.getElementById('battle-log');

  // Fight separator
  const sep = document.createElement('div');
  sep.className = 'log-fight-sep';
  sep.textContent = t('game.js.bl.vs', { monster: monsterName });
  container.appendChild(sep);

  for (const round of log) {
    if (autoBattleStop) break;
    for (const entry of round) {
      const div = document.createElement('div');

      if (entry.by === 'player') {
        if (entry.type === 'hit') {
          monsterHp = Math.max(0, monsterHp - entry.damage);
          div.className = 'log-hit-player';
          div.textContent = t('game.js.bl.hit_player', {
            monster: monsterName, damage: entry.damage,
            hp: Math.round(monsterHp), max: monsterMax,
          });
          setMonsterHpBar(monsterHp, monsterMax);
        } else {
          div.className = 'log-miss-player';
          div.textContent = t('game.js.bl.miss_player', { monster: monsterName });
        }
      } else {
        if (entry.type === 'dodge') {
          div.className = 'log-dodge';
          div.textContent = t('game.js.bl.dodge', { monster: monsterName });
        } else {
          heroHp = Math.max(0, heroHp - entry.damage);
          div.className = 'log-hit-monster';
          div.textContent = t('game.js.bl.hit_monster', {
            monster: monsterName, damage: entry.damage,
            hp: Math.round(heroHp * 10) / 10, max: heroMax,
          });
          setHeroHpBar(heroHp, heroMax);
        }
      }

      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
    await sleep(350);
  }

  // Settle on server truth
  setMonsterHpBar(finalMonsterHp, monsterMax);
  setHeroHpBar(finalHeroHp, heroMax);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Combat Stats ----
async function refreshCombatStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel.classList.contains('open')) return;

  const res = await api.get(`/api/game/${charId}/stats`);
  if (!res || !res.ok) return;
  const s = await res.json();

  document.getElementById('cstat-hp').textContent    = s.maxHp;
  document.getElementById('cstat-dmg').textContent   = s.damage + (s.isRanged ? ' ' + t('game.js.ranged') : ' ' + t('game.js.melee'));
  document.getElementById('cstat-hit').textContent   = s.hitChance + '%';
  document.getElementById('cstat-dodge').textContent = s.dodgeChance + '%';
  document.getElementById('cstat-def').textContent   = s.defense;
}

// ---- Side panels ----
const PANEL_MAP = {
  inventory:  'inv-panel',
  equipment:  'eq-panel',
  attributes: 'attr-panel',
  farm:       'farm-panel',
  battle:     'battle-panel',
  stats:      'stats-panel',
  market:     'market-panel',
};

function openPanel(type) {
  Object.values(PANEL_MAP).forEach(id => document.getElementById(id).classList.remove('open'));
  const panelId = PANEL_MAP[type];
  if (panelId) document.getElementById(panelId).classList.add('open');
  if (type === 'attributes') { pendingAttrs = {}; renderAttributes(charState); }
  if (type === 'farm')   renderFarmPanel();
  if (type === 'market') renderMarketPanel(charState);
  if (type === 'battle') {
    renderBattlePanel(charState);
    if (!autoBattleRunning && charState && charState.dungeonRun) {
      document.getElementById('battle-log').innerHTML = '';
      startAutoBattle();
    }
  }
  if (type === 'stats') refreshCombatStats();
}

function closePanel(type) {
  const panelId = PANEL_MAP[type];
  if (panelId) document.getElementById(panelId).classList.remove('open');
}

// ---- Inventory ----
function renderInventory(char) {
  if (!char) return;
  const grid = document.getElementById('inv-grid');
  const inv  = char.inventory || [];
  const slots = Array(10).fill(null);
  inv.forEach((item, i) => { if (i < 10) slots[i] = item; });
  const equippedIds = new Set([char.weapon_id, char.armor_id].filter(Boolean));

  grid.innerHTML = slots.map((item, i) => {
    if (!item) return `<div class="inv-slot empty" title="Empty">·</div>`;
    const isEq = equippedIds.has(item.item_id);
    return `<div class="inv-slot${isEq ? ' equipped' : ''}" onclick="showItemInfo(${i})" title="${escHtml(item.name)}">
      ${item.icon || '?'}
      ${item.quantity > 1 ? `<span class="qty">${item.quantity}</span>` : ''}
    </div>`;
  }).join('');
}

function showItemInfo(idx) {
  if (!charState) return;
  const item = (charState.inventory || [])[idx];
  const tooltip = document.getElementById('item-tooltip');
  if (!item) { tooltip.style.display = 'none'; return; }
  const isEq = ({ weapon: charState.weapon_id, armor: charState.armor_id })[item.type] === item.item_id;
  const canEquip = item.type === 'weapon' || item.type === 'armor';
  const statLine = item.damage ? `⚔️ ${item.damage} ${t('game.js.dmg_unit')}` : item.defense ? `🛡️ ${item.defense} ${t('game.js.def_unit')}` : '';
  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <strong class="item-tt-name">${item.icon} ${escHtml(item.name)}</strong>
    <span class="item-tt-type">${item.type}${item.weapon_type ? ' · ' + item.weapon_type : ''}</span>
    <p class="item-tt-desc">${escHtml(item.description || '')}${statLine ? ' ' + statLine : ''}</p>
    ${canEquip && !isEq
      ? `<button type="button" class="btn btn-outline btn-sm btn-mt" onclick="equipItem('${item.type}',${item.item_id})">${t('game.js.equip_btn')}</button>`
      : isEq ? `<span class="item-tt-eq">${t('game.js.equipped_check')}</span>` : ''}`;
}

// ---- Equipment ----
function renderEquipment(char) {
  if (!char) return;
  const w = char.equippedWeapon;
  const a = char.equippedArmor;

  document.getElementById('eq-weapon-name').textContent = w ? `${w.icon} ${w.name}` : '—';
  document.getElementById('eq-weapon-stat').textContent =
    w && w.damage ? `⚔️ ${w.damage} ${t('game.js.dmg_unit')} · ${w.weapon_type}` : '';

  document.getElementById('eq-armor-name').textContent = a ? `${a.icon} ${a.name}` : '—';
  document.getElementById('eq-armor-stat').textContent =
    a && a.defense ? `🛡️ ${a.defense} ${t('game.js.def_unit')}` : '';

  const inv = (char.inventory || []).filter(i => i.type === 'weapon' || i.type === 'armor');
  const equippedIds = new Set([char.weapon_id, char.armor_id].filter(Boolean));
  const list = document.getElementById('eq-list');
  if (!inv.length) { list.innerHTML = `<p class="muted-sm">${t('game.js.no_equippable')}</p>`; return; }
  list.innerHTML = inv.map(item => {
    const statLine = item.damage ? `⚔️ ${item.damage} ${t('game.js.dmg_unit')}` : item.defense ? `🛡️ ${item.defense} ${t('game.js.def_unit')}` : '';
    return `
    <div class="equip-list-row">
      <span class="equip-list-icon">${item.icon}</span>
      <span class="equip-list-name">
        ${escHtml(item.name)}
        <span class="equip-list-type">${item.type}${item.weapon_type ? ' · ' + item.weapon_type : ''}</span>
        ${statLine ? `<span class="equip-list-type"> · ${statLine}</span>` : ''}
      </span>
      ${equippedIds.has(item.item_id)
        ? `<span class="equip-list-check">✓</span>`
        : `<button type="button" class="btn btn-outline btn-sm" onclick="equipItem('${item.type}',${item.item_id})">${t('game.js.equip_btn')}</button>`}
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
    const label = t(labelKey);
    const hint  = t(hintKey);
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
  if (charState.activity === 'farm') { stopActivity(); return; }
  if (charState.activity) return;
  startFarm();
}

async function startFarm() {
  const res = await api.post(`/api/game/${charId}/start`, { action: 'farm' });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed_farm'), 'danger'); return; }
  charState = data;
  renderAll(data);
  openPanel('farm');
  showToast(t('game.js.farm_started'), 'success');
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
      const secsLeft = Math.max(0, job.ready_at - now);
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
function renderMarketPanel(char) {
  if (!char) return;
  const gold = Number(char.gold) || 0;
  document.getElementById('market-gold-amount').textContent = `🪙 ${gold}g`;

  const equippedIds = new Set([char.weapon_id, char.armor_id].filter(Boolean));
  const sellable = (char.inventory || []).filter(i => Number(i.sell_price) > 0);
  const list = document.getElementById('market-list');

  if (!sellable.length) {
    list.innerHTML = `<p class="muted-sm">${t('game.js.nothing_to_sell')}</p>`;
    return;
  }

  list.innerHTML = sellable.map(item => {
    const equipped = equippedIds.has(item.item_id);
    const price = Number(item.sell_price);
    return `
      <div class="market-row">
        <span class="market-item-icon">${item.icon}</span>
        <div class="market-item-info">
          <span class="market-item-name">${escHtml(item.name)}</span>
          <span class="market-item-meta">×${item.quantity} &bull; 🪙 ${price}g each</span>
        </div>
        ${equipped
          ? `<span class="market-equipped-tag">${t('game.js.equipped_tag')}</span>`
          : `<button type="button" class="btn btn-outline btn-sm" onclick="sellItem(${item.id},${item.item_id},1)">${t('game.js.sell_one')}</button>`
        }
      </div>`;
  }).join('');
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

// ---- Avatar upload ----
function triggerAvatarUpload() { document.getElementById('avatar-input').click(); }

async function uploadAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'image/jpeg') { showToast(t('game.js.jpeg_only'), 'danger'); return; }
  if (file.size > 1 * 1024 * 1024) { showToast(t('game.js.image_size'), 'danger'); return; }
  const fd = new FormData();
  fd.append('avatar', file);
  const res = await api.postForm(`/api/characters/${charId}/avatar`, fd);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || t('game.js.failed'), 'danger'); return; }
  const img = document.getElementById('avatar-img');
  img.src = data.avatarPath + '?t=' + Date.now();
  img.style.display = 'block';
  document.getElementById('avatar-svg').style.display = 'none';
  if (charState) charState.avatar_path = data.avatarPath;
  showToast(t('game.js.avatar_updated'), 'success');
  e.target.value = '';
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
