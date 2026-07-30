// Swaps the "Log In" nav links for a profile icon + dropdown when someone
// is logged in — either a Simple User (guest, /api/guest) or an RVPark
// Owner (/api/admin/dashboard). Runs on every page via initCore() — cheap
// no-op for anonymous visitors (a 401 from the first check that applies).
import { markGuestLoggedIn, clearGuestSession, isGuestLoggedInLocally } from './guest-session.js';

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function buildProfileWidget({ name, email, dashboardHref, dashboardLabel, logoutUrl, afterLogout }) {
  const wrap = document.createElement('div');
  wrap.className = 'profile-widget';
  wrap.innerHTML = `
    <button type="button" class="profile-avatar-btn" aria-haspopup="true" aria-expanded="false">${initials(name)}</button>
    <div class="profile-dropdown">
      <div class="profile-dropdown-name">${name}</div>
      <div class="profile-dropdown-email">${email}</div>
      <a href="${dashboardHref}">${dashboardLabel}</a>
      <button type="button" class="profile-logout-btn">Log Out</button>
    </div>`;

  const btn = wrap.querySelector('.profile-avatar-btn');
  const dropdown = wrap.querySelector('.profile-dropdown');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) { wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
  });
  dropdown.querySelector('.profile-logout-btn').addEventListener('click', async () => {
    await fetch(logoutUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    afterLogout();
    window.location.href = 'index.html';
  });
  return wrap;
}

function applyToSlots(slots, identity) {
  slots.forEach((el) => {
    if (el.dataset.accountSlot === 'desktop') {
      el.style.display = 'none';
      el.insertAdjacentElement('afterend', buildProfileWidget(identity));
    } else {
      el.textContent = identity.dashboardLabel;
      el.setAttribute('href', identity.dashboardHref);
    }
  });
}

async function tryGuestSession() {
  try {
    const res = await fetch('/api/guest');
    if (!res.ok) return null;
    const { guest } = await res.json();
    return {
      name: guest.name, email: guest.email,
      dashboardHref: 'guest-dashboard.html', dashboardLabel: 'My Bookings',
      logoutUrl: '/api/guest', afterLogout: clearGuestSession,
    };
  } catch {
    return null; // offline or API unavailable (e.g. plain `npm run dev`) — treat as logged out
  }
}

async function tryOwnerSession() {
  try {
    const res = await fetch('/api/admin/dashboard');
    if (!res.ok) return null;
    const { park } = await res.json();
    return {
      name: park.ownerName || park.name || 'Owner', email: park.ownerEmail || '',
      dashboardHref: 'park-dashboard.html', dashboardLabel: 'Dashboard',
      logoutUrl: '/api/admin/auth', afterLogout: () => {},
    };
  } catch {
    return null;
  }
}

export async function initGuestNav() {
  const slots = document.querySelectorAll('[data-account-slot]');
  if (!slots.length) return;

  const guestIdentity = await tryGuestSession();
  if (guestIdentity) {
    markGuestLoggedIn();
    applyToSlots(slots, guestIdentity);
    return;
  }

  // Not a guest — a park-staff session uses a separate cookie, so it's
  // entirely possible to be logged in as an owner and not a guest (or vice
  // versa) at the same time in the same browser.
  const ownerIdentity = await tryOwnerSession();
  if (ownerIdentity) {
    applyToSlots(slots, ownerIdentity);
    return;
  }

  if (isGuestLoggedInLocally()) clearGuestSession(); // local flag was stale (idle-expired elsewhere, or cookie cleared)
}
