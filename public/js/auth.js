// Redirect if already logged in
if (api.getToken()) {
  window.location.href = '/characters.html';
}

function showTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('form-login').style.display    = isLogin ? '' : 'none';
  document.getElementById('form-register').style.display = isLogin ? 'none' : '';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-error').textContent    = '';
  document.getElementById('register-error').textContent = '';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = t('auth.entering');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: document.getElementById('login-username').value.trim(),
        password: document.getElementById('login-password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || t('auth.login_failed');
    } else {
      api.setToken(data.accessToken);
      window.location.href = '/characters.html';
    }
  } catch {
    errEl.textContent = t('auth.network_error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('auth.enter_realm');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('register-btn');
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';

  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;

  if (password !== confirm) {
    errEl.textContent = t('auth.passwords_no_match');
    return;
  }

  btn.disabled = true;
  btn.textContent = t('auth.creating');

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || t('auth.register_failed');
    } else {
      api.setToken(data.accessToken);
      window.location.href = '/characters.html';
    }
  } catch {
    errEl.textContent = t('auth.network_error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('auth.create_account');
  }
}
