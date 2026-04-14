// Guard: redirect if not logged in
if (!api.getToken()) api.redirectToLogin();

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };
let selectedClass = 'Warrior';

// Show username in header
(function () {
  try {
    const payload = JSON.parse(atob(api.getToken().split('.')[1]));
    document.getElementById('header-username').textContent = payload.username || '';
  } catch { /* ignore */ }
})();

async function logout() {
  await api.post('/api/auth/logout');
  api.clearToken();
  window.location.href = '/index.html';
}

// ---- Load characters ----
async function loadChars() {
  const res = await api.get('/api/characters');
  if (!res) return;
  const chars = await res.json();
  renderChars(chars);
}

function renderChars(chars) {
  const grid = document.getElementById('char-grid');
  if (!chars.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h2>No Heroes Yet</h2>
        <p style="color:var(--muted);margin-bottom:1rem;">Your legend has not yet begun.</p>
        <button class="btn btn-primary" onclick="openCreateModal()">+ Create Your First Hero</button>
      </div>`;
    return;
  }

  grid.innerHTML = chars.map(c => {
    const hpPct = Math.round((c.hp / c.max_hp) * 100);
    const activity = c.activity
      ? `<span style="font-size:0.75rem;color:var(--accent);">${c.activity === 'dungeon' ? '🏰 In Dungeon' : '🍺 Resting'}</span>`
      : '';
    return `
      <div class="char-card">
        <div class="char-class-icon">${CLASS_ICONS[c.class] || '?'}</div>
        <div class="char-name">${escHtml(c.name)}</div>
        <div style="text-align:center;">${activity}</div>
        <div style="display:flex;align-items:center;gap:0.5rem;justify-content:center;">
          <span class="char-level-badge">Lv ${c.level}</span>
          <span style="font-size:0.75rem;color:var(--muted);">${c.class}</span>
        </div>
        <div class="char-hp-bar" title="${Math.round(c.hp)}/${c.max_hp} HP">
          <div class="char-hp-bar-fill" style="width:${hpPct}%;background:${hpPct < 30 ? 'var(--danger)' : 'var(--success)'}"></div>
        </div>
        <div style="font-size:0.75rem;color:var(--muted);text-align:center;">${Math.round(c.hp)}/${c.max_hp} HP</div>
        <div class="char-actions">
          <button class="btn btn-primary btn-sm" onclick="playChar(${c.id})">Play</button>
          <button class="btn btn-danger btn-sm" onclick="deleteChar(${c.id}, '${escHtml(c.name)}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function playChar(id) {
  localStorage.setItem('activeCharacterId', id);
  window.location.href = '/game.html';
}

async function deleteChar(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const res = await api.delete(`/api/characters/${id}`);
  if (res && res.ok) {
    showToast(`${name} has been retired.`, 'warn');
    loadChars();
  } else {
    showToast('Could not delete character.', 'danger');
  }
}

// ---- Create character modal ----
function openCreateModal() {
  document.getElementById('create-modal').classList.add('open');
  document.getElementById('char-name').focus();
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.remove('open');
  document.getElementById('create-error').textContent = '';
  document.getElementById('create-form').reset();
  // Reset class selection
  document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
  document.querySelector('[data-class="Warrior"]').classList.add('selected');
  selectedClass = 'Warrior';
}

function selectClass(el) {
  document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedClass = el.dataset.class;
}

async function handleCreateChar(e) {
  e.preventDefault();
  const btn = document.getElementById('create-btn');
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Forging…';

  const name = document.getElementById('char-name').value.trim();
  const res = await api.post('/api/characters', { name, class: selectedClass });

  btn.disabled = false;
  btn.textContent = 'Create Hero';

  if (!res) return;
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Failed to create character';
    return;
  }

  closeCreateModal();
  showToast(`${data.name} the ${data.class} is ready!`, 'success');
  loadChars();
}

// Close modal on overlay click
document.getElementById('create-modal').addEventListener('click', function (e) {
  if (e.target === this) closeCreateModal();
});

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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
loadChars();
