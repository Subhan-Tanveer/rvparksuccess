import '../css/tokens.css';
import { initCore } from './core.js';
import { enforceGuestIdleTimeout, markGuestLoggedIn, clearGuestSession, initGuestActivityTracking } from './guest-session.js';

initCore();

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadDashboard() {
  const wentIdle = await enforceGuestIdleTimeout();
  if (wentIdle) {
    window.location.href = 'guest-login.html?reason=idle';
    return;
  }

  const res = await fetch('/api/guest');
  if (res.status === 401) {
    clearGuestSession();
    window.location.href = 'guest-login.html';
    return;
  }
  const data = await res.json();
  markGuestLoggedIn();
  initGuestActivityTracking();
  document.getElementById('gate').style.display = 'block';
  document.getElementById('guestNameHeading').textContent = `Welcome back, ${data.guest.name.split(' ')[0]}`;
  renderBookings(data.bookings);
}

function renderBookings(bookings) {
  const tbody = document.getElementById('bookingsTableBody');
  const emptyEl = document.getElementById('bookingsEmpty');
  if (!bookings.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = bookings.map((b) => `
    <tr>
      <td>${b.parkName}</td>
      <td>${b.checkIn} → ${b.checkOut}</td>
      <td><span class="status-chip ${b.status === 'confirmed' ? 'is-confirmed' : 'is-pending'}">${b.status}</span></td>
      <td>${formatUsd(b.totalCents)}</td>
    </tr>`).join('');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
  clearGuestSession();
  window.location.href = 'guest-login.html';
});

loadDashboard();
