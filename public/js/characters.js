// Guard: redirect if not logged in
if (!api.getToken()) api.redirectToLogin();

const CLASS_ICONS = { Warrior: '⚔️', Mage: '🔮', Rogue: '🗡️', Cleric: '✝️' };
let selectedClass = 'Warrior';
let selectedGender = 'male';
let selectedAvatar = '/avatars/selection/male_selection_A.png';
let wizardStep = 1;

const GENDER_AVATARS = {
  male:   ['/avatars/selection/male_selection_A.png',   '/avatars/selection/male_selection_B.png'],
  female: ['/avatars/selection/female_selection_A.png', '/avatars/selection/female_selection_B.png'],
};

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
        <h2>${t('char.no_heroes')}</h2>
        <p style="color:var(--muted);margin-bottom:1rem;">${t('char.legend')}</p>
        <button class="btn btn-primary" onclick="openCreateModal()">${t('char.create_first')}</button>
      </div>`;
    return;
  }

  grid.innerHTML = chars.map(c => {
    const hpPct = Math.round((c.hp / c.max_hp) * 100);
    const activity = c.activity
      ? `<span style="font-size:0.75rem;color:var(--accent);">${c.activity === 'dungeon' ? t('char.in_dungeon') : t('char.resting')}</span>`
      : '';
    const avatarHtml = c.avatar_path
      ? `<div class="char-avatar"><img src="${escHtml(c.avatar_path)}" alt="${escHtml(c.name)}" /></div>`
      : `<div class="char-class-icon">${CLASS_ICONS[c.class] || '?'}</div>`;
    return `
      <div class="char-card">
        ${avatarHtml}
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
          <button class="btn btn-primary btn-sm" onclick="playChar(${c.id})">${t('char.play')}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteChar(${c.id}, '${escHtml(c.name)}')">${t('char.delete')}</button>
        </div>
      </div>`;
  }).join('');
}

function playChar(id) {
  localStorage.setItem('activeCharacterId', id);
  window.location.href = '/game.html';
}

async function deleteChar(id, name) {
  if (!confirm(t('char.delete_confirm', { name }))) return;
  const res = await api.delete(`/api/characters/${id}`);
  if (res && res.ok) {
    showToast(t('char.retired', { name }), 'warn');
    loadChars();
  } else {
    showToast(t('char.cant_delete'), 'danger');
  }
}

// ---- Wizard ----
function setVisible(id, visible) {
  const el = document.getElementById(id);
  el.classList.toggle('wizard-hidden', !visible);
  el.classList.toggle('wizard-step-hidden', !visible);
}

function goToStep(n) {
  wizardStep = n;
  setVisible('wizard-step-1', n === 1);
  setVisible('wizard-step-2', n === 2);
  setVisible('wizard-next',   n === 1);
  setVisible('wizard-back',   n === 2);
  setVisible('create-btn',    n === 2);
  document.getElementById('step-dot-1').classList.toggle('active', n === 1);
  document.getElementById('step-dot-2').classList.toggle('active', n === 2);
  document.getElementById('create-error').textContent = '';
}

function wizardNext() {
  const name = document.getElementById('char-name').value.trim();
  const errEl = document.getElementById('create-error');
  if (!name) {
    errEl.textContent = 'Please enter a hero name.';
    document.getElementById('char-name').focus();
    return;
  }
  goToStep(2);
}

function wizardBack() {
  goToStep(1);
}

// ---- Create character modal ----
function openCreateModal() {
  document.getElementById('create-modal').classList.add('open');
  goToStep(1);
  document.getElementById('char-name').focus();
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.remove('open');
  document.getElementById('create-error').textContent = '';
  document.getElementById('create-form').reset();
  // Reset class
  document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
  document.querySelector('[data-class="Warrior"]').classList.add('selected');
  selectedClass = 'Warrior';
  // Reset gender + avatar
  selectedGender = 'male';
  selectedAvatar = GENDER_AVATARS.male[0];
  document.querySelectorAll('.gender-tab').forEach(tb => tb.classList.remove('active'));
  document.querySelector('[data-gender="male"]').classList.add('active');
  renderAvatarGrid('male');
  goToStep(1);
}

function selectClass(el) {
  document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedClass = el.dataset.class;
}

function selectGender(el) {
  document.querySelectorAll('.gender-tab').forEach(tb => tb.classList.remove('active'));
  el.classList.add('active');
  selectedGender = el.dataset.gender;
  selectedAvatar = GENDER_AVATARS[selectedGender][0];
  renderAvatarGrid(selectedGender);
}

function selectAvatar(el) {
  document.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedAvatar = el.dataset.avatar;
}

function renderAvatarGrid(gender) {
  const grid = document.getElementById('avatar-grid');
  const avatars = GENDER_AVATARS[gender];
  grid.innerHTML = avatars.map((path, i) => `
    <div class="avatar-card${i === 0 ? ' selected' : ''}" data-avatar="${escHtml(path)}" onclick="selectAvatar(this)">
      <img src="${escHtml(path)}" alt="${gender} ${i === 0 ? 'A' : 'B'}" />
    </div>`).join('');
}

async function handleCreateChar(e) {
  e.preventDefault();
  const btn = document.getElementById('create-btn');
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = t('char.forging');

  const name = document.getElementById('char-name').value.trim();
  const res = await api.post('/api/characters', {
    name,
    class: selectedClass,
    gender: selectedGender,
    avatar: selectedAvatar,
  });

  btn.disabled = false;
  btn.textContent = t('char.create_hero');

  if (!res) return;
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || t('char.failed_create');
    return;
  }

  closeCreateModal();
  showToast(t('char.ready', { name: data.name, cls: data.class }), 'success');
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
