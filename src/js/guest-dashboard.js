import '../css/tokens.css';
import { initCore } from './core.js';
import { enforceGuestIdleTimeout, markGuestLoggedIn, clearGuestSession, initGuestActivityTracking } from './guest-session.js';
import { confirmDialog, alertDialog, withLoading } from './ui-dialogs.js';

initCore();

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusChip(status) {
  if (status === 'confirmed') return { cls: 'is-confirmed', label: 'confirmed' };
  if (status === 'confirmed-deposit') return { cls: 'is-deposit', label: 'deposit paid' };
  if (status === 'canceled') return { cls: 'is-canceled', label: 'canceled' };
  return { cls: 'is-pending', label: 'pending' };
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
  tbody.innerHTML = bookings.map((b) => {
    const canCancel = b.status !== 'canceled' && new Date(b.checkIn) > new Date();
    return `
    <tr>
      <td>${b.parkName}</td>
      <td>${b.checkIn} → ${b.checkOut}</td>
      <td>${(() => { const c = statusChip(b.status); return `<span class="status-chip ${c.cls}">${c.label}</span>`; })()}</td>
      <td>${formatUsd(b.totalCents)}</td>
      <td>${b.status === 'confirmed-deposit' ? formatUsd(b.balanceCents) : '—'}</td>
      <td>${canCancel ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel="${b.id}">Cancel</button>` : ''}</td>
    </tr>`;
  }).join('');
}

document.getElementById('bookingsTableBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (!btn) return;
  const ok = await confirmDialog({
    title: 'Cancel Reservation',
    message: 'Cancel this reservation? This frees the site for other guests and cannot be undone.',
    confirmLabel: 'Cancel Booking', cancelLabel: 'Keep It', danger: true,
  });
  if (!ok) return;

  await withLoading(btn, async () => {
    try {
      const res = await fetch('/api/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reservationId: btn.dataset.cancel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel');
      loadDashboard();
    } catch (err) {
      await alertDialog({ title: 'Error', message: err.message });
    }
  });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
  clearGuestSession();
  window.location.href = 'guest-login.html';
});

loadDashboard();
