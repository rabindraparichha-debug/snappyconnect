/**
 * SnappyConnect background service worker.
 *
 * Pure transport layer: forwards call requests from the content script to
 * the SnappyConnect API with the stored token. The API decides how the
 * call is placed; if it returns a dialUrl (Telnyx web dialer), we open it.
 */

const DEFAULTS = { apiUrl: 'http://localhost:4000/api/v1' };

async function getConfig() {
  const stored = await chrome.storage.sync.get(['apiUrl', 'token']);
  return { apiUrl: stored.apiUrl || DEFAULTS.apiUrl, token: stored.token || null };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'SC_CALL') {
    handleCall(message.number).then(sendResponse);
    return true; // async response
  }
  if (message && message.type === 'SC_LOGIN') {
    handleLogin(message.apiUrl, message.email, message.password).then(sendResponse);
    return true;
  }
  return undefined;
});

async function handleCall(number) {
  const { apiUrl, token } = await getConfig();
  if (!token) {
    return { ok: false, message: 'Not signed in — open the SnappyConnect extension popup.' };
  }
  try {
    const res = await fetch(`${apiUrl}/calls/click-to-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ phoneNumber: number, source: 'extension' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
      return { ok: false, message: message || `Call failed (${res.status})` };
    }
    // Telnyx users dial from the browser: open the web dialer pre-filled.
    if (data.action === 'client_dial' && data.dialUrl) {
      await chrome.tabs.create({ url: data.dialUrl });
    }
    return { ok: true, message: data.message || 'Call request sent' };
  } catch (err) {
    return { ok: false, message: 'Could not reach SnappyConnect API' };
  }
}

async function handleLogin(apiUrl, email, password) {
  const base = apiUrl || DEFAULTS.apiUrl;
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: data.message || 'Login failed' };
    }
    await chrome.storage.sync.set({ apiUrl: base, token: data.accessToken, user: data.user });
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, message: 'Could not reach SnappyConnect API' };
  }
}
