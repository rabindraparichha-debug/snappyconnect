'use strict';

const loginView = document.getElementById('login-view');
const userView = document.getElementById('user-view');
const loginError = document.getElementById('login-error');
const callResult = document.getElementById('call-result');

async function refresh() {
  const stored = await chrome.storage.sync.get(['apiUrl', 'token', 'user']);
  if (stored.apiUrl) document.getElementById('api-url').value = stored.apiUrl;
  if (stored.token && stored.user) {
    loginView.classList.add('hidden');
    userView.classList.remove('hidden');
    document.getElementById('user-name').textContent = stored.user.name || '';
    document.getElementById('user-email').textContent = stored.user.email || '';
  } else {
    loginView.classList.remove('hidden');
    userView.classList.add('hidden');
  }
}

document.getElementById('login-btn').addEventListener('click', () => {
  loginError.classList.add('hidden');
  const apiUrl = document.getElementById('api-url').value.trim().replace(/\/+$/, '');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  chrome.runtime.sendMessage({ type: 'SC_LOGIN', apiUrl, email, password }, (response) => {
    if (response && response.ok) {
      refresh();
    } else {
      loginError.textContent = (response && response.message) || 'Login failed';
      loginError.classList.remove('hidden');
    }
  });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await chrome.storage.sync.remove(['token', 'user']);
  refresh();
});

document.getElementById('quick-call-btn').addEventListener('click', () => {
  const number = document.getElementById('quick-number').value.trim();
  if (!number) return;
  callResult.classList.add('hidden');
  chrome.runtime.sendMessage({ type: 'SC_CALL', number }, (response) => {
    callResult.textContent = (response && response.message) || 'Call request sent';
    callResult.classList.remove('hidden');
  });
});

refresh();
