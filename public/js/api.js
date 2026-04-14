/**
 * api.js — Thin fetch wrapper with JWT refresh logic.
 * Stores access token in sessionStorage.
 * On 401, retries once via /api/auth/refresh.
 * On second 401, redirects to index.html.
 */

const TOKEN_KEY = 'mero_access_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function refreshToken() {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) return false;
  const data = await res.json();
  setToken(data.accessToken);
  return true;
}

function redirectToLogin() {
  clearToken();
  window.location.href = '/index.html';
}

async function request(method, path, body, isRetry = false) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers, credentials: 'include' };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);

  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshToken();
    if (refreshed) return request(method, path, body, true);
    redirectToLogin();
    return null;
  }

  return res;
}

async function postForm(path, formData, isRetry = false) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshToken();
    if (refreshed) return postForm(path, formData, true);
    redirectToLogin();
    return null;
  }

  return res;
}

const api = {
  get:      (path)       => request('GET',    path),
  post:     (path, body) => request('POST',   path, body),
  put:      (path, body) => request('PUT',    path, body),
  delete:   (path)       => request('DELETE', path),
  postForm: (path, fd)   => postForm(path, fd),
  setToken,
  getToken,
  clearToken,
  redirectToLogin,
};

window.api = api;
