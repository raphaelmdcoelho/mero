// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

const ATTRS = [
  { key: 'strength',     label: 'Strength',     icon: '⚔️',  hint: 'Melee damage' },
  { key: 'dexterity',    label: 'Dexterity',    icon: '🏹',  hint: 'Hit chance & ranged damage' },
  { key: 'agility',      label: 'Agility',      icon: '💨',  hint: 'Dodge chance' },
  { key: 'vitality',     label: 'Vitality',     icon: '❤️',  hint: 'Max HP' },
  { key: 'intelligence', label: 'Intelligence', icon: '🔮',  hint: '' },
  { key: 'focus',        label: 'Focus',        icon: '🎯',  hint: '' },
  { key: 'stamina',      label: 'Stamina',      icon: '🛡️',  hint: '' },
  { key: 'resistance',   label: 'Resistance',   icon: '🌀',  hint: 'Defense' },
];

const DUNGEON_LEVEL_ICONS = ['','🌿','🪨','💀','🌑','🔥','🧊','⚡','🌊','☠️','🐉'];

let charState  = null;
let tickInterval = null;
let pendingAttrs = {};
let selectedDungeonLevel = 1;

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
}

// ---- Render ----
function renderAll(char) {
  document.getElementById('char-name-header').textContent = char.name || '';
  document.getElementById('char-class-header').textContent =
    `${CLASS_ICONS[char.class] || ''} ${char.class || ''} · Level ${char.level}`;

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

  document.getElementById('level-display').textContent = `Level ${char.level}`;

  const unspent = Number(char.unspent_points) || 0;
  const badge  = document.getElementById('unspent-badge');
  const headerNotice = document.getElementById('unspent-header');
  if (unspent > 0) {
    badge.textContent = unspent;
    badge.style.display = 'flex';
    headerNotice.textContent = `✨ ${unspent} point${unspent !== 1 ? 's' : ''} to spend`;
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
      actLabel.textContent = `🏰 Dungeon Lv.${lvl}`;
    } else {
      actLabel.textContent = '🍺 Resting';
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
    document.getElementById('sq-farm').classList.add('disabled');
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

  renderInventory(char);
  renderEquipment(char);
  renderAttributes(char);
  renderFarmPanel();
  renderBattlePanel(char);
  refreshCombatStats();
}

function updateActionSquares(activity) {
  const dungeon = document.getElementById('sq-dungeon');
  const tavern  = document.getElementById('sq-tavern');
  const inv     = document.getElementById('sq-inventory');
  const eq      = document.getElementById('sq-equipment');
  const attrs   = document.getElementById('sq-attributes');
  const stats   = document.getElementById('sq-stats');

  [dungeon, tavern, inv, eq, attrs, stats].forEach(el => el.classList.remove('active', 'disabled'));

  if (activity === 'dungeon') {
    dungeon.classList.add('active');
    dungeon.querySelector('span:last-child').textContent = 'Dungeon';
    tavern.classList.add('disabled');
  } else if (activity === 'tavern') {
    tavern.classList.add('active');
    tavern.querySelector('span:last-child').textContent = 'Stop';
    dungeon.classList.add('disabled');
  } else {
    dungeon.querySelector('span:last-child').textContent = 'Dungeon';
    tavern.querySelector('span:last-child').textContent = 'Tavern';
  }
}

// ---- Action handlers ----
function handleDungeon() {
  if (!charState) return;
  if (charState.activity === 'dungeon') { openPanel('battle'); return; }
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
  if (!res.ok) { showToast(data.error || 'Failed', 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast('Resting at the tavern…', 'success');
}

async function stopActivity() {
  const res = await api.post(`/api/game/${charId}/stop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to stop', 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast('Activity stopped.', '');
}

// ---- Dungeon level modal ----
function openDungeonModal() {
  const mastery = Number(charState.dungeon_mastery) || 0;
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

  document.getElementById('dungeon-modal').classList.add('open');
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
  const res = await api.post(`/api/game/${charId}/dungeon/enter`, { level: selectedDungeonLevel });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to enter dungeon', 'danger'); return; }
  charState = data;
  renderAll(data);
  openPanel('battle');
  showToast(`Entered Dungeon Level ${selectedDungeonLevel}!`, 'success');
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

  document.getElementById('battle-title').textContent =
    `🏰 Dungeon Lv.${run.dungeon_level} — Mastery: ${char.dungeon_mastery || 0}`;

  const isBoss = monster.is_boss === 1;
  document.getElementById('battle-kills-label').textContent = `${run.kills} / 100 monsters`;
  document.getElementById('battle-boss-label').style.display = isBoss ? 'inline' : 'none';

  document.getElementById('monster-icon').textContent = monster.icon;
  document.getElementById('monster-name').textContent = (isBoss ? '👑 BOSS: ' : '') + monster.name;

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

async function doAttack() {
  const btn = document.getElementById('attack-btn');
  btn.disabled = true;
  btn.textContent = '…';

  const res = await api.post(`/api/game/${charId}/dungeon/attack`);
  if (!res) { btn.disabled = false; btn.textContent = '⚔️ Attack'; return; }

  const data = await res.json();
  if (!res.ok) {
    btn.disabled = false; btn.textContent = '⚔️ Attack';
    showToast(data.error || 'Attack failed', 'danger'); return;
  }

  // Snapshot HP before the fight settled so we can animate from current values
  const prevMonsterHp  = charState.dungeonRun ? Number(charState.dungeonRun.monster_hp) : 0;
  const prevMonsterMax = charState.dungeonRun ? charState.dungeonRun.monster.hp : 1;
  const monsterName    = charState.dungeonRun ? charState.dungeonRun.monster.name : 'Monster';
  const prevHeroHp     = Number(charState.hp);
  const heroMax        = Number(charState.max_hp);

  // Animate the combat log and bars, then settle
  await animateCombatLog(
    data.combatLog,
    monsterName,
    prevMonsterHp, prevMonsterMax,
    prevHeroHp,    heroMax,
    data.char.dungeonRun ? Number(data.char.dungeonRun.monster_hp) : 0,
    Number(data.char.hp)
  );

  // Apply final state
  charState = data.char;
  renderAll(data.char);
  btn.disabled = false;
  btn.textContent = '⚔️ Attack';

  if (data.result === 'defeat') {
    showToast('Your hero has fallen! Return to the dungeon to try again.', 'danger');
    closePanel('battle');
    return;
  }
  if (data.result === 'run_complete') {
    showToast(`🏆 Boss defeated! Dungeon mastery is now ${data.newMastery}!`, 'success');
    if (data.droppedItem) showToast(`💎 Dropped: ${data.droppedItem.icon} ${data.droppedItem.name}!`, 'success');
    closePanel('battle');
    return;
  }
  if (data.result === 'monster_killed') {
    showToast(`+${data.gainedXp} XP`, 'success');
    if (data.droppedItem) showToast(`💎 ${data.droppedItem.icon} ${data.droppedItem.name} dropped!`, 'success');
    if (data.bossSpawned) showToast('⚠️ The Boss appears!', 'warn');
  }
}

// Replay each round with a delay, updating HP bars live
async function animateCombatLog(
  log, monsterName,
  monsterHp, monsterMax,
  heroHp, heroMax,
  finalMonsterHp, finalHeroHp
) {
  const container = document.getElementById('battle-log');
  const empty = container.querySelector('.battle-log-empty');
  if (empty) empty.remove();

  // Add a fight separator
  const sep0 = document.createElement('div');
  sep0.className = 'log-fight-sep';
  sep0.textContent = '── New fight ──';
  container.appendChild(sep0);

  // Calculate damage deltas per round so we can step HP
  // Each round is [playerAction, optionalMonsterAction]
  for (const round of log) {
    for (const entry of round) {
      const div = document.createElement('div');

      if (entry.by === 'player') {
        if (entry.type === 'hit') {
          monsterHp = Math.max(0, monsterHp - entry.damage);
          div.className = 'log-hit-player';
          div.textContent =
            `⚔️ You hit ${monsterName} for ${entry.damage} dmg — ${monsterName} HP: ${Math.round(monsterHp)}/${monsterMax}`;
          setMonsterHpBar(monsterHp, monsterMax);
        } else {
          div.className = 'log-miss-player';
          div.textContent = `💨 Your attack missed ${monsterName}!`;
        }
      } else {
        if (entry.type === 'dodge') {
          div.className = 'log-dodge';
          div.textContent = `🌀 You dodged ${monsterName}'s attack!`;
        } else {
          heroHp = Math.max(0, heroHp - entry.damage);
          div.className = 'log-hit-monster';
          div.textContent =
            `💥 ${monsterName} hits you for ${entry.damage} dmg — Your HP: ${Math.round(heroHp * 10) / 10}/${heroMax}`;
          setHeroHpBar(heroHp, heroMax);
        }
      }

      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }

    // Small pause between rounds so the player can follow
    await sleep(120);
  }

  // Ensure bars settle on server truth (rounding may differ)
  setMonsterHpBar(finalMonsterHp, monsterMax);
  setHeroHpBar(finalHeroHp, heroMax);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function doFlee() {
  const res = await api.post(`/api/game/${charId}/dungeon/flee`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed', 'danger'); return; }
  charState = data;
  renderAll(data);
  closePanel('battle');
  showToast('You fled the dungeon.', 'warn');
}

// ---- Combat Stats ----
async function refreshCombatStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel.classList.contains('open')) return;

  const res = await api.get(`/api/game/${charId}/stats`);
  if (!res || !res.ok) return;
  const s = await res.json();

  document.getElementById('cstat-hp').textContent    = s.maxHp;
  document.getElementById('cstat-dmg').textContent   = s.damage + (s.isRanged ? ' (ranged)' : ' (melee)');
  document.getElementById('cstat-hit').textContent   = s.hitChance + '%';
  document.getElementById('cstat-dodge').textContent = s.dodgeChance + '%';
  document.getElementById('cstat-def').textContent   = s.defense;
}

// ---- Side panels ----
function openPanel(type) {
  const panelMap = {
    inventory:  'inv-panel',
    equipment:  'eq-panel',
    attributes: 'attr-panel',
    farm:       'farm-panel',
    battle:     'battle-panel',
    stats:      'stats-panel',
  };
  Object.values(panelMap).forEach(id => document.getElementById(id).classList.remove('open'));
  const panelId = panelMap[type];
  if (panelId) document.getElementById(panelId).classList.add('open');
  if (type === 'attributes') { pendingAttrs = {}; renderAttributes(charState); }
  if (type === 'farm')       renderFarmPanel();
  if (type === 'battle') {
    document.getElementById('battle-log').innerHTML = '<div class="battle-log-empty">Press Attack to begin!</div>';
    renderBattlePanel(charState);
  }
  if (type === 'stats') refreshCombatStats();
}

function closePanel(type) {
  const panelMap = {
    inventory:  'inv-panel',
    equipment:  'eq-panel',
    attributes: 'attr-panel',
    farm:       'farm-panel',
    battle:     'battle-panel',
    stats:      'stats-panel',
  };
  const panelId = panelMap[type];
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
  const statLine = item.damage ? `⚔️ ${item.damage} dmg` : item.defense ? `🛡️ ${item.defense} def` : '';
  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <strong class="item-tt-name">${item.icon} ${escHtml(item.name)}</strong>
    <span class="item-tt-type">${item.type}${item.weapon_type ? ' · ' + item.weapon_type : ''}</span>
    <p class="item-tt-desc">${escHtml(item.description || '')}${statLine ? ' ' + statLine : ''}</p>
    ${canEquip && !isEq
      ? `<button type="button" class="btn btn-outline btn-sm btn-mt" onclick="equipItem('${item.type}',${item.item_id})">Equip</button>`
      : isEq ? `<span class="item-tt-eq">✓ Equipped</span>` : ''}`;
}

// ---- Equipment ----
function renderEquipment(char) {
  if (!char) return;
  const w = char.equippedWeapon;
  const a = char.equippedArmor;

  document.getElementById('eq-weapon-name').textContent = w ? `${w.icon} ${w.name}` : 'None';
  document.getElementById('eq-weapon-stat').textContent =
    w && w.damage ? `⚔️ ${w.damage} damage · ${w.weapon_type}` : '';

  document.getElementById('eq-armor-name').textContent = a ? `${a.icon} ${a.name}` : 'None';
  document.getElementById('eq-armor-stat').textContent =
    a && a.defense ? `🛡️ ${a.defense} defense` : '';

  const inv = (char.inventory || []).filter(i => i.type === 'weapon' || i.type === 'armor');
  const equippedIds = new Set([char.weapon_id, char.armor_id].filter(Boolean));
  const list = document.getElementById('eq-list');
  if (!inv.length) { list.innerHTML = '<p class="muted-sm">No equippable items.</p>'; return; }
  list.innerHTML = inv.map(item => {
    const statLine = item.damage ? `⚔️ ${item.damage} dmg` : item.defense ? `🛡️ ${item.defense} def` : '';
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
        : `<button type="button" class="btn btn-outline btn-sm" onclick="equipItem('${item.type}',${item.item_id})">Equip</button>`}
    </div>`;
  }).join('');
}

async function equipItem(slot, itemId) {
  const res = await api.put(`/api/characters/${charId}/equip`, { slot, item_id: itemId });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Could not equip item', 'danger'); return; }
  charState = { ...charState, ...data };
  renderEquipment(charState);
  renderInventory(charState);
  showToast('Item equipped!', 'success');
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
  list.innerHTML = ATTRS.map(({ key, label, icon, hint }) => {
    const base  = Number(char[`attr_${key}`]) || 5;
    const delta = pendingAttrs[key] || 0;
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
  if (!res.ok) { showToast(data.error || 'Could not allocate points', 'danger'); return; }
  pendingAttrs = {};
  charState = { ...charState, ...data };
  renderAll(charState);
  showToast('Attributes updated!', 'success');
  refreshCombatStats();
}

// ---- Farm ----
function handleFarm() {
  if (!charState) return;
  if (Number(charState.level) < 3) { showToast('Farming unlocks at level 3!', 'danger'); return; }
  openPanel('farm');
}

async function startGrowing(plantType) {
  const res = await api.post(`/api/farm/${charId}/grow`, { plant_type: plantType });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to start growing', 'danger'); return; }
  const icon = plantType === 'carrot' ? '🥕' : '🍎';
  showToast(`${icon} ${plantType.charAt(0).toUpperCase() + plantType.slice(1)} planted!`, 'success');
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
    stockList.innerHTML = '<span style="font-size:0.8rem;color:var(--muted);">Nothing harvested yet.</span>';
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
    queueList.innerHTML = '<span style="font-size:0.8rem;color:var(--muted);">No plants growing.</span>';
  } else {
    queueList.innerHTML = queue.map(job => {
      const icon     = job.plant_type === 'carrot' ? '🥕' : '🍎';
      const secsLeft = Math.max(0, job.ready_at - now);
      const mins     = Math.floor(secsLeft / 60);
      const secs     = secsLeft % 60;
      const timeStr  = secsLeft === 0 ? 'Ready!' : `${mins}m ${String(secs).padStart(2,'0')}s`;
      return `<div style="display:flex;align-items:center;gap:0.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.4rem 0.6rem;margin-bottom:0.35rem;">
        <span style="font-size:1.1rem;">${icon}</span>
        <span style="font-size:0.8rem;flex:1;">${job.plant_type}</span>
        <span style="font-size:0.75rem;color:var(--muted);">${timeStr}</span>
      </div>`;
    }).join('');
  }
}

// ---- Avatar upload ----
function triggerAvatarUpload() { document.getElementById('avatar-input').click(); }

async function uploadAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'image/jpeg') { showToast('Only JPEG images are accepted.', 'danger'); return; }
  if (file.size > 1 * 1024 * 1024) { showToast('Image must be under 1 MB.', 'danger'); return; }
  const fd = new FormData();
  fd.append('avatar', file);
  const res = await api.postForm(`/api/characters/${charId}/avatar`, fd);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Upload failed', 'danger'); return; }
  const img = document.getElementById('avatar-img');
  img.src = data.avatarPath + '?t=' + Date.now();
  img.style.display = 'block';
  document.getElementById('avatar-svg').style.display = 'none';
  if (charState) charState.avatar_path = data.avatarPath;
  showToast('Avatar updated!', 'success');
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
