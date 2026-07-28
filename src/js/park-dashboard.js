import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let currentPark = null;
let currentSites = [];
let selectedSiteId = null;

/* -- load everything on page open -- */
async function loadDashboard() {
  const res = await fetch('/api/admin/dashboard');
  if (res.status === 401) {
    window.location.href = 'park-login.html';
    return;
  }
  const data = await res.json();
  currentPark = data.park;
  currentSites = data.sites;

  document.getElementById('gate').style.display = 'block';
  document.getElementById('parkNameHeading').textContent = `${currentPark.name} — Staff`;
  renderSites(currentSites);
  renderReservations(data.reservations);

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const twoNightsLater = new Date(tomorrow); twoNightsLater.setDate(twoNightsLater.getDate() + 2);
  const checkInEl = document.getElementById('bkCheckIn');
  const checkOutEl = document.getElementById('bkCheckOut');
  checkInEl.value = tomorrow.toISOString().slice(0, 10);
  checkOutEl.value = twoNightsLater.toISOString().slice(0, 10);
  checkInEl.classList.add('has-value');
  checkOutEl.classList.add('has-value');
}

/* -- sites table -- */
function renderSites(sites) {
  const tbody = document.getElementById('sitesTableBody');
  const emptyEl = document.getElementById('sitesEmpty');
  if (!sites.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = sites.map((s) => `
    <tr>
      <td>${s.name}</td>
      <td>${s.type}</td>
      <td>${s.capacity}</td>
      <td>${formatUsd(s.nightlyRateCents)}/night</td>
      <td style="text-align:right; white-space:nowrap;">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-site="${s.id}">Edit Rate</button>
        <button type="button" class="btn btn-ghost btn-sm" data-delete-site="${s.id}">Delete</button>
      </td>
    </tr>`).join('');
}

document.getElementById('sitesTableBody').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit-site]');
  const deleteBtn = e.target.closest('[data-delete-site]');

  if (editBtn) {
    const site = currentSites.find((s) => s.id === editBtn.dataset.editSite);
    const input = prompt(`New nightly rate for ${site.name} (current: ${formatUsd(site.nightlyRateCents)}):`, (site.nightlyRateCents / 100).toFixed(2));
    if (input === null) return;
    const dollars = parseFloat(input);
    if (isNaN(dollars) || dollars <= 0) return alert('Enter a valid rate.');
    const res = await fetch('/api/admin/sites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: site.id, nightlyRateCents: Math.round(dollars * 100) }),
    });
    if (res.ok) loadDashboard();
    else alert((await res.json()).error || 'Could not update site');
  }

  if (deleteBtn) {
    const site = currentSites.find((s) => s.id === deleteBtn.dataset.deleteSite);
    if (!confirm(`Delete ${site.name}? This can't be undone.`)) return;
    const res = await fetch('/api/admin/sites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: site.id }),
    });
    if (res.ok) loadDashboard();
    else alert((await res.json()).error || 'Could not delete site');
  }
});

/* -- add site -- */
const addSiteForm = document.getElementById('addSiteForm');
const addSiteBtn = document.getElementById('addSiteBtn');
const siteAlert = document.getElementById('siteAlert');

addSiteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  siteAlert.classList.remove('is-visible', 'is-success', 'is-error');
  addSiteBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('sName').value,
        type: document.getElementById('sType').value,
        capacity: document.getElementById('sCapacity').value,
        nightlyRateCents: Math.round(parseFloat(document.getElementById('sRate').value) * 100),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not add site');
    siteAlert.textContent = `${data.site.name} added.`;
    siteAlert.classList.add('is-visible', 'is-success');
    addSiteForm.reset();
    loadDashboard();
  } catch (err) {
    siteAlert.textContent = err.message;
    siteAlert.classList.add('is-visible', 'is-error');
  } finally {
    addSiteBtn.disabled = false;
  }
});

/* -- new booking: check availability -- */
document.getElementById('checkAvailBtn').addEventListener('click', async () => {
  const checkIn = document.getElementById('bkCheckIn').value;
  const checkOut = document.getElementById('bkCheckOut').value;
  const grid = document.getElementById('bookingSitesGrid');
  document.getElementById('bookingForm').style.display = 'none';
  selectedSiteId = null;
  if (!checkIn || !checkOut) return;

  const params = new URLSearchParams({ park: currentPark.id, checkIn, checkOut });
  const res = await fetch(`/api/reservations/availability?${params}`);
  if (!res.ok) { grid.innerHTML = '<div class="admin-empty">Could not load availability.</div>'; return; }
  const data = await res.json();

  if (!data.sites.length) {
    grid.innerHTML = '<div class="admin-empty">Nothing open for those dates.</div>';
    return;
  }
  grid.innerHTML = data.sites.map((s) => `
    <div class="booking-site-btn" data-site="${s.id}">
      <div class="name">${s.name}</div>
      <div class="meta">${s.type} · Sleeps ${s.capacity}</div>
      <div class="rate">${formatUsd(s.totalCents)} total</div>
    </div>`).join('');
});

document.getElementById('bookingSitesGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.booking-site-btn');
  if (!btn) return;
  document.querySelectorAll('.booking-site-btn').forEach((b) => b.classList.remove('is-selected'));
  btn.classList.add('is-selected');
  selectedSiteId = btn.dataset.site;
  document.getElementById('selectedSiteLabel').textContent = `Booking: ${btn.querySelector('.name').textContent}`;
  document.getElementById('bookingForm').style.display = 'block';
});

/* -- new booking: confirm -- */
const bookingForm = document.getElementById('bookingForm');
const confirmBookingBtn = document.getElementById('confirmBookingBtn');
const bookingAlert = document.getElementById('bookingAlert');

bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedSiteId) return;
  bookingAlert.classList.remove('is-visible', 'is-success', 'is-error');
  confirmBookingBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/staff-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: selectedSiteId,
        checkIn: document.getElementById('bkCheckIn').value,
        checkOut: document.getElementById('bkCheckOut').value,
        guestName: document.getElementById('gName').value,
        guestEmail: document.getElementById('gEmail').value,
        guestPhone: document.getElementById('gPhone').value,
        paymentMethod: document.getElementById('paymentMethod').value,
        notes: document.getElementById('gNotes').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create booking');

    bookingAlert.textContent = `Booked — ${data.reservation.status === 'confirmed' ? 'confirmed' : 'held for 24 hours pending payment'}.`;
    bookingAlert.classList.add('is-visible', 'is-success');
    bookingForm.reset();
    bookingForm.style.display = 'none';
    document.getElementById('bookingSitesGrid').innerHTML = '';
    selectedSiteId = null;
    loadDashboard();
  } catch (err) {
    bookingAlert.textContent = err.message;
    bookingAlert.classList.add('is-visible', 'is-error');
  } finally {
    confirmBookingBtn.disabled = false;
  }
});

/* -- reservations table -- */
function renderReservations(reservations) {
  const tbody = document.getElementById('reservationsTableBody');
  const emptyEl = document.getElementById('reservationsEmpty');
  if (!reservations.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = reservations.map((r) => `
    <tr>
      <td>${r.guestName}</td>
      <td>${r.checkIn} → ${r.checkOut}</td>
      <td>${r.source === 'staff' ? 'Staff' : 'Website'}</td>
      <td><span class="status-chip ${r.status === 'confirmed' ? 'is-confirmed' : 'is-pending'}">${r.status}</span></td>
      <td>${formatUsd(r.totalCents)}</td>
    </tr>`).join('');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = 'park-login.html';
});

loadDashboard();
