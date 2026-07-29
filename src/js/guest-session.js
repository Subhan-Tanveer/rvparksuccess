// Client-side guest session bookkeeping — tracks activity in localStorage so
// a guest who goes idle for too long gets logged out even though the actual
// session cookie (set server-side in api/guest.js) is httpOnly and can't be
// read from here. This file only ever *reacts* to that cookie; the cookie
// itself remains the real source of truth for whether a request is allowed.
const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours of inactivity
const LOGGED_IN_KEY = 'rvps_guest_logged_in';
const LAST_ACTIVE_KEY = 'rvps_guest_last_active';
const ACTIVITY_THROTTLE_MS = 60 * 1000; // don't hammer localStorage on every mousemove

export function isGuestLoggedInLocally() {
  return localStorage.getItem(LOGGED_IN_KEY) === '1';
}

export function markGuestLoggedIn() {
  localStorage.setItem(LOGGED_IN_KEY, '1');
  localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
}

export function clearGuestSession() {
  localStorage.removeItem(LOGGED_IN_KEY);
  localStorage.removeItem(LAST_ACTIVE_KEY);
}

function touchActivity() {
  if (isGuestLoggedInLocally()) localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
}

async function logoutOnServer() {
  await fetch('/api/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'logout' }),
  }).catch(() => {});
}

/**
 * Call at the top of any page that trusts a logged-in guest state (the
 * dashboard, the checkout pre-fill). Returns true if the guest had gone
 * idle past the limit and has now been logged out — the caller should treat
 * them as signed out from that point on.
 */
export async function enforceGuestIdleTimeout() {
  if (!isGuestLoggedInLocally()) return false;
  const lastActive = parseInt(localStorage.getItem(LAST_ACTIVE_KEY) || '0', 10);
  if (Date.now() - lastActive <= IDLE_LIMIT_MS) {
    touchActivity();
    return false;
  }
  await logoutOnServer();
  clearGuestSession();
  return true;
}

/** Call once per page (safe to call even when the guest isn't logged in — it's a no-op then). */
export function initGuestActivityTracking() {
  if (!isGuestLoggedInLocally()) return;
  let last = 0;
  const handler = () => {
    const now = Date.now();
    if (now - last > ACTIVITY_THROTTLE_MS) { last = now; touchActivity(); }
  };
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => window.addEventListener(evt, handler, { passive: true }));
}
