// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

const ATTRS = [
  { key: 'strength',     label: 'Strength',     icon: '⚔️' },
  { key: 'dexterity',    label: 'Dexterity',    icon: '🏹' },
  { key: 'agility',      label: 'Agility',      icon: '💨' },
  { key: 'vitality',     label: 'Vitality',     icon: '❤️' },
  { key: 'intelligence', label: 'Intelligence', icon: '🔮' },
  { key: 'focus',        label: 'Focus',        icon: '🎯' },
  { key: 'stamina',      label: 'Stamina',      icon: '🛡️' },
  { key: 'resistance',   label: 'Resistance',   icon: '🌀' },
];

let charState = null;
let tickInterval = null;
let selectedDiff = 'easy';

// Pending attribute allocations { key: delta }
let pendingAttrs = {};

// ---- Init ----
async function init() {
  const res = await api.get(`/api/game/${charId}/tick`);
  if (!res) return;
  const data = await res.json();
  charState = data;
  renderAll(data);
  startTick();
}

// ---- Tick ----
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
  if (data.fallen) showToast('Your hero has fallen! Retreating from the dungeon…', 'danger');
  if (data.plantConsumed) {
    const icon = data.plantConsumed === 'carrot' ? '🥕' : '🍎';
    showToast(`${icon} A ${data.plantConsumed} was consumed to keep you alive!`, 'warn');
  }
  if (data.readingFinished) showToast('📖 Reading session complete! Check your attribute points.', 'success');
}

// ---- Render ----
function renderAll(char) {
  // Header
  document.getElementById('char-name-header').textContent = char.name || '';
  document.getElementById('char-class-header').textContent =
    `${CLASS_ICONS[char.class] || ''} ${char.class || ''} · Level ${char.level}`;

  // Avatar
  if (char.avatar_path) {
    const img = document.getElementById('avatar-img');
    img.src = char.avatar_path + '?t=' + Date.now();
    img.style.display = 'block';
    document.getElementById('avatar-svg').style.display = 'none';
  }

  // XP bar
  const xpPct = char.xp_to_next > 0 ? Math.min(100, (char.xp / char.xp_to_next) * 100) : 100;
  document.getElementById('xp-fill').style.width = xpPct + '%';
  document.getElementById('xp-text').textContent = `${Math.floor(char.xp)} / ${char.xp_to_next}`;

  // HP bar
  const hp = Math.max(0, char.hp);
  const hpPct = char.max_hp > 0 ? Math.min(100, (hp / char.max_hp) * 100) : 0;
  const hpFill = document.getElementById('hp-fill');
  hpFill.style.width = hpPct + '%';
  hpFill.className = 'stat-fill hp' + (hpPct < 30 ? ' low' : '');
  document.getElementById('hp-text').textContent = `${Math.round(hp * 10) / 10} / ${char.max_hp}`;

  // Level
  document.getElementById('level-display').textContent = `Level ${char.level}`;

  // Unspent points indicators
  const unspent = Number(char.unspent_points) || 0;
  const badge = document.getElementById('unspent-badge');
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

  // Activity badge
  const actBadge = document.getElementById('activity-badge');
  const actLabel = document.getElementById('activity-label');
  if (char.activity) {
    actBadge.style.display = 'inline-flex';
    if (char.activity === 'dungeon') {
      actLabel.textContent = `🏰 ${char.dungeon_difficulty || ''} dungeon`;
    } else if (char.activity === 'tavern') {
      actLabel.textContent = '🍺 Resting';
    } else if (char.activity === 'reading') {
      const elapsed = Math.floor(Date.now() / 1000) - (char.activity_started_at || 0);
      const minsLeft = Math.max(0, Math.ceil((3600 - elapsed) / 60));
      const pts = Number(char.reading_points_awarded) || 0;
      actLabel.textContent = `📖 Reading · ${minsLeft}m left · ${pts}/2 pts`;
    }
  } else {
    actBadge.style.display = 'none';
  }

  // Action squares
  updateActionSquares(char.activity);

  // Farm square: lock badge when level < 3, stock badge when plants in stock
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

  // Refresh open panels
  renderInventory(char);
  renderEquipment(char);
  renderAttributes(char);
  renderFarmPanel();
}

function updateActionSquares(activity) {
  const dungeon = document.getElementById('sq-dungeon');
  const tavern  = document.getElementById('sq-tavern');
  const inv     = document.getElementById('sq-inventory');
  const eq      = document.getElementById('sq-equipment');
  const attrs   = document.getElementById('sq-attributes');
  const farm    = document.getElementById('sq-farm');
  const read    = document.getElementById('sq-read');

  [dungeon, tavern, inv, eq, attrs, farm, read].forEach(el => el.classList.remove('active', 'disabled'));

  if (activity === 'dungeon') {
    dungeon.classList.add('active');
    dungeon.querySelector('span:last-child').textContent = 'Stop';
    tavern.classList.add('disabled');
    read.classList.add('disabled');
  } else if (activity === 'tavern') {
    tavern.classList.add('active');
    tavern.querySelector('span:last-child').textContent = 'Stop';
    dungeon.classList.add('disabled');
    read.classList.add('disabled');
  } else if (activity === 'reading') {
    read.classList.add('active');
    read.querySelector('span:last-child').textContent = 'Stop';
    dungeon.classList.add('disabled');
    tavern.classList.add('disabled');
  } else {
    dungeon.querySelector('span:last-child').textContent = 'Dungeon';
    tavern.querySelector('span:last-child').textContent = 'Tavern';
    read.querySelector('span:last-child').textContent = 'Read';
  }
}

// ---- Action handlers ----
function handleDungeon() {
  if (!charState) return;
  if (charState.activity === 'dungeon') stopActivity();
  else if (!charState.activity) openDiffModal();
}

function handleTavern() {
  if (!charState) return;
  if (charState.activity === 'tavern') stopActivity();
  else if (!charState.activity) startActivity('tavern');
}

async function startActivity(action, difficulty) {
  const body = { action };
  if (action === 'dungeon') body.difficulty = difficulty;
  const res = await api.post(`/api/game/${charId}/start`, body);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to start activity', 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast(action === 'dungeon' ? `Entered ${difficulty} dungeon!` : 'Resting at the tavern…', 'success');
}

async function stopActivity() {
  const res = await api.post(`/api/game/${charId}/stop`);
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to stop activity', 'danger'); return; }
  charState = data;
  renderAll(data);
  showToast('Activity stopped.', '');
}

// ---- Difficulty modal ----
function openDiffModal() { document.getElementById('diff-modal').classList.add('open'); }
function closeDiffModal() { document.getElementById('diff-modal').classList.remove('open'); }
function selectDiff(el) {
  document.querySelectorAll('.diff-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedDiff = el.dataset.diff;
}
function confirmDungeon() { closeDiffModal(); startActivity('dungeon', selectedDiff); }
document.getElementById('diff-modal').addEventListener('click', function (e) {
  if (e.target === this) closeDiffModal();
});

// ---- Side panels ----
function openPanel(type) {
  const panelMap = { inventory: 'inv-panel', equipment: 'eq-panel', attributes: 'attr-panel', farm: 'farm-panel' };
  Object.values(panelMap).forEach(id => document.getElementById(id).classList.remove('open'));
  const panelId = panelMap[type];
  if (panelId) document.getElementById(panelId).classList.add('open');
  if (type === 'attributes') { pendingAttrs = {}; renderAttributes(charState); }
  if (type === 'farm') renderFarmPanel();
}

function closePanel(type) {
  const panelMap = { inventory: 'inv-panel', equipment: 'eq-panel', attributes: 'attr-panel', farm: 'farm-panel' };
  const panelId = panelMap[type];
  if (panelId) document.getElementById(panelId).classList.remove('open');
}

// ---- Inventory ----
function renderInventory(char) {
  if (!char) return;
  const grid = document.getElementById('inv-grid');
  const inv = char.inventory || [];
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
  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <strong class="item-tt-name">${item.icon} ${escHtml(item.name)}</strong>
    <span class="item-tt-type">${item.type}</span>
    <p class="item-tt-desc">${escHtml(item.description || '')}</p>
    ${canEquip && !isEq
      ? `<button type="button" class="btn btn-outline btn-sm btn-mt" onclick="equipItem('${item.type}',${item.item_id})">Equip</button>`
      : isEq ? `<span class="item-tt-eq">✓ Equipped</span>` : ''}`;
}

// ---- Equipment ----
function renderEquipment(char) {
  if (!char) return;
  document.getElementById('eq-weapon-name').textContent =
    char.equippedWeapon ? `${char.equippedWeapon.icon} ${char.equippedWeapon.name}` : 'None';
  document.getElementById('eq-armor-name').textContent =
    char.equippedArmor ? `${char.equippedArmor.icon} ${char.equippedArmor.name}` : 'None';

  const inv = (char.inventory || []).filter(i => i.type === 'weapon' || i.type === 'armor');
  const equippedIds = new Set([char.weapon_id, char.armor_id].filter(Boolean));
  const list = document.getElementById('eq-list');
  if (!inv.length) { list.innerHTML = '<p class="muted-sm">No equippable items.</p>'; return; }
  list.innerHTML = inv.map(item => `
    <div class="equip-list-row">
      <span class="equip-list-icon">${item.icon}</span>
      <span class="equip-list-name">${escHtml(item.name)} <span class="equip-list-type">${item.type}</span></span>
      ${equippedIds.has(item.item_id)
        ? `<span class="equip-list-check">✓</span>`
        : `<button type="button" class="btn btn-outline btn-sm" onclick="equipItem('${item.type}',${item.item_id})">Equip</button>`}
    </div>`).join('');
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
}

// ---- Attributes ----
function renderAttributes(char) {
  if (!char) return;
  const unspent = Number(char.unspent_points) || 0;
  const pendingTotal = Object.values(pendingAttrs).reduce((s, v) => s + v, 0);
  const remaining = unspent - pendingTotal;

  // Unspent bar
  const bar = document.getElementById('attr-unspent-bar');
  const pointsEl = document.getElementById('attr-points-left');
  if (unspent > 0) {
    bar.classList.add('visible');
    pointsEl.textContent = `${remaining} / ${unspent}`;
  } else {
    bar.classList.remove('visible');
  }

  // Confirm button
  const confirmRow = document.getElementById('attr-confirm-row');
  confirmRow.classList.toggle('visible', pendingTotal > 0);

  // Attribute rows
  const list = document.getElementById('attr-list');
  list.innerHTML = ATTRS.map(({ key, label, icon }) => {
    const base  = Number(char[`attr_${key}`]) || 5;
    const delta = pendingAttrs[key] || 0;
    return `
      <div class="attr-row">
        <span class="attr-icon">${icon}</span>
        <span class="attr-name">${label}</span>
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

  if (delta > 0 && pendingTotal >= unspent) return; // no points left
  if (delta < 0 && current <= 0) return;            // can't go below 0 pending

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
}

// ---- Read ----
function handleRead() {
  if (!charState) return;
  if (charState.activity === 'reading') {
    stopActivity();
  } else if (!charState.activity) {
    startActivity('reading');
    showToast('📖 Your hero starts reading. +1 attr point every 30 min (max 2).', 'success');
  }
}

// ---- Farm ----
function handleFarm() {
  if (!charState) return;
  if (Number(charState.level) < 3) {
    showToast('Farming unlocks at level 3!', 'danger');
    return;
  }
  openPanel('farm');
}

async function startGrowing(plantType) {
  const res = await api.post(`/api/farm/${charId}/grow`, { plant_type: plantType });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Failed to start growing', 'danger'); return; }
  const icon = plantType === 'carrot' ? '🥕' : '🍎';
  showToast(`${icon} ${plantType.charAt(0).toUpperCase() + plantType.slice(1)} planted!`, 'success');
  // Update charState farmQueue from response
  charState = { ...charState, farmQueue: data.farmQueue };
  renderAll(charState);
}

function renderFarmPanel() {
  const char = charState;
  if (!char) return;

  const now = Math.floor(Date.now() / 1000);

  // Stock
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

  // Queue
  const queueList = document.getElementById('farm-queue-list');
  const queue = char.farmQueue || [];
  if (!queue.length) {
    queueList.innerHTML = '<span style="font-size:0.8rem;color:var(--muted);">No plants growing.</span>';
  } else {
    queueList.innerHTML = queue.map(job => {
      const icon    = job.plant_type === 'carrot' ? '🥕' : '🍎';
      const secsLeft = Math.max(0, job.ready_at - now);
      const mins    = Math.floor(secsLeft / 60);
      const secs    = secsLeft % 60;
      const timeStr = secsLeft === 0 ? 'Ready!' : `${mins}m ${String(secs).padStart(2,'0')}s`;
      return `<div style="display:flex;align-items:center;gap:0.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.4rem 0.6rem;margin-bottom:0.35rem;">
        <span style="font-size:1.1rem;">${icon}</span>
        <span style="font-size:0.8rem;flex:1;">${job.plant_type}</span>
        <span style="font-size:0.75rem;color:var(--muted);⋆">${timeStr}</span>
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
