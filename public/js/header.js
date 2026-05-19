/**
 * Shared site header — injected synchronously so i18n/lang-switcher
 * picks it up on DOMContentLoaded without a flash.
 */
(function () {
  const path = window.location.pathname;

  function navBtn(href, icon, label, pageMatch) {
    const active = path.includes(pageMatch) ? ' active' : '';
    return `<a href="${href}" class="header-nav-btn${active}">
        <span class="header-nav-icon">${icon}</span>
        <span class="header-nav-label">${label}</span>
      </a>`;
  }

  const heroActive   = path.includes('game.html')   ? ' active' : '';
  const socialActive = path.includes('social.html') ? ' active' : '';

  const html = `
<header class="site-header">
  <div class="header-left">
    <a href="/characters.html" class="game-logo">MERO</a>
    <div>
      <div id="char-name-header" class="header-char-name"></div>
      <div id="char-class-header" class="header-char-class"></div>
    </div>
  </div>
  <nav class="header-nav">
    ${navBtn('/game.html',   '⚔️', 'Hero',   'game.html')}
    ${navBtn('/social.html', '👥', 'Social', 'social.html')}
    <button type="button" class="header-nav-btn" disabled>
      <span class="header-nav-icon">🏰</span>
      <span class="header-nav-label">Castle</span>
    </button>
  </nav>
  <div class="header-right">
    <div id="activity-badge" class="activity-badge">
      <div class="activity-dot"></div>
      <span id="activity-label">Active</span>
    </div>
    <div class="lang-switcher"></div>
    <a href="/characters.html" class="btn btn-outline btn-sm header-desktop-only" data-i18n="game.heroes_link">← Heroes</a>
    <button type="button" class="btn btn-outline btn-sm header-desktop-only" onclick="siteLogout()" data-i18n="game.logout">Logout</button>
    <button type="button" class="hamburger-btn" id="hamburger-btn" aria-label="Menu" onclick="toggleMobileNav()">
      <span></span><span></span><span></span>
    </button>
  </div>
  <div class="mobile-nav" id="mobile-nav">
    <a href="/game.html" class="header-nav-btn${heroActive}">
      <span class="header-nav-icon">⚔️</span>
      <span class="header-nav-label">Hero</span>
    </a>
    <a href="/social.html" class="header-nav-btn${socialActive}">
      <span class="header-nav-icon">👥</span>
      <span class="header-nav-label">Social</span>
    </a>
    <button type="button" class="header-nav-btn" disabled>
      <span class="header-nav-icon">🏰</span>
      <span class="header-nav-label">Castle</span>
    </button>
    <div class="mobile-nav-divider"></div>
    <a href="/characters.html" class="btn btn-outline btn-sm" data-i18n="game.heroes_link">← Heroes</a>
    <button type="button" class="btn btn-outline btn-sm" onclick="siteLogout()" data-i18n="game.logout">Logout</button>
  </div>
</header>`;

  const placeholder = document.getElementById('app-header');
  placeholder.outerHTML = html;
})();

function toggleMobileNav() {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('hamburger-btn');
  const open = nav.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open);
}

// Close mobile nav when clicking outside
document.addEventListener('click', function (e) {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('hamburger-btn');
  if (nav && nav.classList.contains('open') && !nav.contains(e.target) && !btn.contains(e.target)) {
    nav.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', false);
  }
});

function siteLogout() {
  const TOKEN_KEY = 'mero_access_token';
  fetch('/api/auth/logout', { method: 'POST' }).finally(function () {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.href = '/index.html';
  });
}
