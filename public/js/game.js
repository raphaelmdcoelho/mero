// Guard
if (!api.getToken()) api.redirectToLogin();
const charId = localStorage.getItem('activeCharacterId');
if (!charId) { window.location.href = '/characters.html'; }

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };

let charState = null;
let tickInterval = null;
let selectedDiff = 'easy';

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

  if (data.fallen) {
    showToast('Your hero has fallen! Retreating from the dungeon…', 'danger');
  }
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

  // Activity badge
  const badge = document.getElementById('activity-badge');
  const label = document.getElementById('activity-label');
  if (char.activity) {
    badge.style.display = 'inline-flex';
    label.textContent = char.activity === 'dungeon'
      ? `🏰 ${char.dungeon_difficulty || ''} dungeon`
      : '🍺 Resting';
  } else {
    badge.style.display = 'none';
  }

  // Action squares
  updateActionSquares(char.activity);

  // Panels (if open)
  renderInventory(char);
  renderEquipment(char);
}

function updateActionSquares(activity) {
  const dungeon  = document.getElementById('sq-dungeon');
  const tavern   = document.getElementById('sq-tavern');
  const inv      = document.getElementById('sq-inventory');
  const eq       = document.getElementById('sq-equipment');

  [dungeon, tavern, inv, eq].forEach(el => {
    el.classList.remove('active', 'disabled');
  });

  if (activity === 'dungeon') {
    dungeon.classList.add('active');
    dungeon.querySelector('span:last-child').textContent = 'Stop';
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
  if (charState.activity === 'dungeon') {
    stopActivity();
  } else if (!charState.activity) {
    openDiffModal();
  }
}

function handleTavern() {
  if (!charState) return;
  if (charState.activity === 'tavern') {
    stopActivity();
  } else if (!charState.activity) {
    startActivity('tavern');
  }
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
  showToast(action === 'dungeon'
    ? `Entered ${difficulty} dungeon!`
    : 'Resting at the tavern…', 'success');
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
function openDiffModal() {
  document.getElementById('diff-modal').classList.add('open');
}
function closeDiffModal() {
  document.getElementById('diff-modal').classList.remove('open');
}
function selectDiff(el) {
  document.querySelectorAll('.diff-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedDiff = el.dataset.diff;
}
function confirmDungeon() {
  closeDiffModal();
  startActivity('dungeon', selectedDiff);
}
document.getElementById('diff-modal').addEventListener('click', function (e) {
  if (e.target === this) closeDiffModal();
});

// ---- Side panels ----
function openPanel(type) {
  if (type === 'inventory') {
    document.getElementById('inv-panel').classList.add('open');
    renderInventory(charState);
  } else {
    document.getElementById('eq-panel').classList.add('open');
    renderEquipment(charState);
  }
}
function closePanel(type) {
  if (type === 'inventory') document.getElementById('inv-panel').classList.remove('open');
  else document.getElementById('eq-panel').classList.remove('open');
}

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
    return `<div class="inv-slot${isEq ? ' equipped' : ''}"
      onclick="showItemInfo(${i})"
      title="${escHtml(item.name)}"
    >
      ${item.icon || '?'}
      ${item.quantity > 1 ? `<span class="qty">${item.quantity}</span>` : ''}
    </div>`;
  }).join('');

  // Store for tooltip
  grid._items = inv;
}

function showItemInfo(idx) {
  if (!charState) return;
  const inv = charState.inventory || [];
  const item = inv[idx];
  const tooltip = document.getElementById('item-tooltip');
  if (!item) { tooltip.style.display = 'none'; return; }

  const equippedIds = { weapon: charState.weapon_id, armor: charState.armor_id };
  const isEq = equippedIds[item.type] === item.item_id;
  const canEquip = item.type === 'weapon' || item.type === 'armor';

  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <strong style="font-family:'Cinzel',serif;">${item.icon} ${escHtml(item.name)}</strong>
    <span style="color:var(--muted);font-size:0.75rem;margin-left:0.5rem;">${item.type}</span>
    <p style="color:var(--muted);margin-top:0.25rem;">${escHtml(item.description || '')}</p>
    ${canEquip && !isEq
      ? `<button class="btn btn-outline btn-sm" style="margin-top:0.5rem;" onclick="equipItem('${item.type}',${item.item_id})">Equip</button>`
      : isEq ? `<span style="color:var(--gold);font-size:0.8rem;">✓ Equipped</span>` : ''}
  `;
}

function renderEquipment(char) {
  if (!char) return;
  document.getElementById('eq-weapon-name').textContent =
    char.equippedWeapon ? `${char.equippedWeapon.icon} ${char.equippedWeapon.name}` : 'None';
  document.getElementById('eq-armor-name').textContent =
    char.equippedArmor ? `${char.equippedArmor.icon} ${char.equippedArmor.name}` : 'None';

  const inv = (char.inventory || []).filter(i => i.type === 'weapon' || i.type === 'armor');
  const equippedIds = new Set([char.weapon_id, char.armor_id].filter(Boolean));
  const list = document.getElementById('eq-list');
  if (!inv.length) { list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;">No equippable items.</p>'; return; }

  list.innerHTML = inv.map(item => `
    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:0.5rem 0.75rem;">
      <span style="font-size:1.3rem;">${item.icon}</span>
      <span style="flex:1;font-size:0.9rem;">${escHtml(item.name)} <span style="color:var(--muted);font-size:0.75rem;">${item.type}</span></span>
      ${equippedIds.has(item.item_id)
        ? `<span style="color:var(--gold);font-size:0.8rem;">✓</span>`
        : `<button class="btn btn-outline btn-sm" onclick="equipItem('${item.type}',${item.item_id})">Equip</button>`}
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

// ---- Avatar upload ----
function triggerAvatarUpload() {
  document.getElementById('avatar-input').click();
}

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

  // Update avatar
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
