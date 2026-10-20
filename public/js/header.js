/**
 * Shared site header — injected synchronously so i18n/lang-switcher
 * picks it up on DOMContentLoaded without a flash.
 */
(function () {
  const path = window.location.pathname;

  // Pixel-art icons keep the nav in the same visual language as the Hero tiles.
  const NAV = [
    { href: '/game.html',   icon: '/equipment-icon.png',  label: 'Hero',    page: 'game.html' },
    { href: '/social.html', icon: '/achivements_icon.png', label: 'Social',  page: 'social.html' },
    { href: null,           icon: '/castle-icon.png',     label: 'Castle',  page: null },
  ];

  function navItem(n) {
    const inner = `<span class="header-nav-icon"><img src="${n.icon}" alt="" /></span>
        <span class="header-nav-label">${n.label}</span>`;
    if (!n.href) return `<button type="button" class="header-nav-btn" disabled>${inner}</button>`;
    const active = path.includes(n.page) ? ' active' : '';
    return `<a href="${n.href}" class="header-nav-btn${active}">${inner}</a>`;
  }

  const navHtml = NAV.map(navItem).join('\n    ');

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
    ${navHtml}
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
    ${navHtml}
    <div class="mobile-nav-divider"></div>
    <a href="/characters.html" class="btn btn-outline btn-sm" data-i18n="game.heroes_link">← Heroes</a>
    <button type="button" class="btn btn-outline btn-sm" onclick="siteLogout()" data-i18n="game.logout">Logout</button>
  </div>
</header>`;

  const placeholder = document.getElementById('app-header');
  placeholder.outerHTML = html;

  // Torch embers over every in-game page except the leaderboard, whose art has its own fire
  if (!path.includes('social.html')) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="embers" aria-hidden="true">' + '<span class="ember"></span>'.repeat(10) + '</div>');
  }
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
