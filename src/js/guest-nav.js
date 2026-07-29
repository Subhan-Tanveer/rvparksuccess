// Swaps the "My Account" nav links for a profile icon + dropdown when a
// guest is logged in. Runs on every page via initCore() — cheap no-op for
// anonymous visitors (a single GET that comes back 401).
import { markGuestLoggedIn, clearGuestSession, isGuestLoggedInLocally } from './guest-session.js';

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function buildProfileWidget(guest) {
  const wrap = document.createElement('div');
  wrap.className = 'profile-widget';
  wrap.innerHTML = `
    <button type="button" class="profile-avatar-btn" aria-haspopup="true" aria-expanded="false">${initials(guest.name)}</button>
    <div class="profile-dropdown">
      <div class="profile-dropdown-name">${guest.name}</div>
      <div class="profile-dropdown-email">${guest.email}</div>
      <a href="guest-dashboard.html">My Bookings</a>
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
    await fetch('/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    clearGuestSession();
    window.location.href = 'index.html';
  });
  return wrap;
}

export async function initGuestNav() {
  const slots = document.querySelectorAll('[data-account-slot]');
  if (!slots.length) return;

  let guest = null;
  try {
    const res = await fetch('/api/guest');
    if (res.ok) guest = (await res.json()).guest;
  } catch {
    // offline or API unavailable (e.g. plain `npm run dev`) — treat as logged out
  }

  if (!guest) {
    if (isGuestLoggedInLocally()) clearGuestSession(); // local flag was stale (idle-expired elsewhere, or cookie cleared)
    return;
  }

  markGuestLoggedIn();

  slots.forEach((el) => {
    if (el.dataset.accountSlot === 'desktop') {
      el.style.display = 'none';
      el.insertAdjacentElement('afterend', buildProfileWidget(guest));
    } else {
      el.textContent = 'My Bookings';
      el.setAttribute('href', 'guest-dashboard.html');
    }
  });
}
