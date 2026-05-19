/**
 * Shared status bar + footer — injected synchronously, identical on every page.
 * game.js populates the dynamic IDs on the Hero page; for all other pages the
 * DOMContentLoaded handler below fetches the tick API directly.
 */
(function () {
  const html = `
<div class="status-bar">
  <div class="status-workers-wrap">
    <span class="status-section-title">Workers</span>
    <span class="status-workers-count" id="workers-count">0</span>
  </div>
  <div class="status-book-wrap">
    <span class="status-section-title">Busy</span>
    <div id="pickaxe-wrap" class="pickaxe-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" style="image-rendering:pixelated;image-rendering:crisp-edges;">
        <rect x="6"  y="58" width="52" height="4"  fill="#000" opacity="0.2"/>
        <rect x="4"  y="6"  width="56" height="4"  fill="#b45309"/>
        <rect x="4"  y="54" width="56" height="4"  fill="#78350f"/>
        <rect x="4"  y="8"  width="4"  height="46" fill="#78350f"/>
        <rect x="56" y="8"  width="4"  height="46" fill="#78350f"/>
        <rect x="8"  y="10" width="22" height="44" fill="#fef9c3"/>
        <rect x="34" y="10" width="22" height="44" fill="#fef9c3"/>
        <rect x="28" y="5"  width="8"  height="54" fill="#3b1f0a"/>
        <rect x="30" y="7"  width="2"  height="50" fill="#92400e"/>
        <rect x="31" y="18" width="2"  height="2"  fill="#d97706"/>
        <rect x="31" y="26" width="2"  height="2"  fill="#d97706"/>
        <rect x="31" y="34" width="2"  height="2"  fill="#d97706"/>
        <rect x="31" y="42" width="2"  height="2"  fill="#d97706"/>
        <rect x="26" y="10" width="4"  height="44" fill="#000" opacity="0.12"/>
        <rect x="34" y="10" width="3"  height="44" fill="#000" opacity="0.08"/>
        <rect x="10" y="13" width="18" height="3"  fill="#d97706"/>
        <rect x="10" y="19" width="18" height="2"  fill="#94a3b8"/>
        <rect x="10" y="23" width="14" height="2"  fill="#94a3b8"/>
        <rect x="10" y="27" width="18" height="2"  fill="#94a3b8"/>
        <rect x="10" y="31" width="16" height="2"  fill="#94a3b8"/>
        <rect x="10" y="35" width="18" height="2"  fill="#94a3b8"/>
        <rect x="10" y="39" width="12" height="2"  fill="#94a3b8"/>
        <rect x="10" y="43" width="18" height="2"  fill="#94a3b8"/>
        <rect x="14" y="50" width="6"  height="2"  fill="#cbd5e1"/>
        <rect x="36" y="13" width="18" height="2"  fill="#94a3b8"/>
        <rect x="36" y="17" width="16" height="2"  fill="#94a3b8"/>
        <rect x="36" y="21" width="18" height="2"  fill="#94a3b8"/>
        <rect x="36" y="25" width="14" height="2"  fill="#94a3b8"/>
        <rect x="36" y="29" width="18" height="2"  fill="#94a3b8"/>
        <rect x="36" y="33" width="16" height="2"  fill="#94a3b8"/>
        <rect x="36" y="37" width="18" height="2"  fill="#94a3b8"/>
        <rect x="36" y="41" width="12" height="2"  fill="#94a3b8"/>
        <rect x="36" y="45" width="16" height="2"  fill="#94a3b8"/>
        <rect x="44" y="50" width="6"  height="2"  fill="#cbd5e1"/>
        <rect x="50" y="4"  width="4"  height="14" fill="#dc2626"/>
        <rect x="50" y="18" width="2"  height="2"  fill="#dc2626"/>
        <rect x="52" y="18" width="2"  height="2"  fill="#dc2626"/>
        <rect class="book-page-flip" x="32" y="10" width="24" height="44" fill="#fffbeb"/>
      </svg>
    </div>
  </div>
  <div class="status-bars">
    <span class="status-section-title">Character Status</span>
    <div class="stat-row">
      <span class="stat-label">HP</span>
      <div class="stat-track"><div class="stat-fill hp" id="hp-fill" style="width:100%"></div></div>
      <span class="stat-value" id="hp-text">— / —</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">XP</span>
      <div class="stat-track"><div class="stat-fill xp" id="xp-fill" style="width:0%"></div></div>
      <span class="stat-value" id="xp-text">— / —</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">ST</span>
      <div class="stat-track"><div class="stat-fill stamina" id="stamina-fill" style="width:100%"></div></div>
      <span class="stat-value" id="stamina-text">— / —</span>
    </div>
    <!-- kept hidden so game.js can write to it without errors -->
    <span id="level-display" style="display:none;"></span>
    <span id="unspent-header" class="status-unspent" style="display:none;" onclick="openPanel && openPanel('attributes')"></span>
  </div>
  <div class="status-money-wrap">
    <span class="status-section-title">Money</span>
    <span class="status-money-value" id="gold-display">🪙 —</span>
  </div>
</div>
<footer class="site-footer">
  <span class="version-badge">Alpha v0.1</span>
</footer>`;

  document.getElementById('app-footer').outerHTML = html;
})();

// Load character stats on pages that don't have game.js (e.g. Social)
document.addEventListener('DOMContentLoaded', function () {
  if (typeof renderAll === 'function') return; // game.js already handles this

  const charId = localStorage.getItem('activeCharacterId');
  if (!charId || !window.api) return;

  api.get('/api/game/' + charId + '/tick').then(function (res) {
    if (!res) return;
    return res.json();
  }).then(function (char) {
    if (!char) return;

    var hp    = Math.max(0, Number(char.hp)         || 0);
    var maxHp = Number(char.max_hp)                 || 1;
    var xp    = Number(char.xp)                     || 0;
    var xpMax = Number(char.xp_to_next)             || 1;
    var st    = Math.max(0, Number(char.stamina)    || 0);
    var maxSt = Number(char.max_stamina)            || 1;

    function setBar(fillId, textId, val, max, floor) {
      var el = document.getElementById(fillId);
      if (el) el.style.width = Math.min(100, (val / max) * 100) + '%';
      var tx = document.getElementById(textId);
      if (tx) tx.textContent = (floor ? Math.floor(val) : Math.ceil(val)) + ' / ' + max;
    }

    setBar('hp-fill',      'hp-text',      hp, maxHp, false);
    setBar('xp-fill',      'xp-text',      xp, xpMax, true);
    setBar('stamina-fill', 'stamina-text', st, maxSt, true);

    var goldEl = document.getElementById('gold-display');
    if (goldEl) goldEl.textContent = '🪙 ' + (Number(char.gold) || 0) + 'g';

    var nameEl = document.getElementById('char-name-header');
    if (nameEl) nameEl.textContent = char.name || '';
    var classEl = document.getElementById('char-class-header');
    if (classEl) classEl.textContent = char.class || '';
  }).catch(function () { /* stats unavailable, bars stay at defaults */ });
});
