import '../css/tokens.css';
import { initCore } from './core.js';

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
  renderStats(data.stats);
  document.getElementById('stTaxRate').value = currentPark.taxRatePercent ?? 0;
  document.getElementById('stTaxRate').classList.add('has-value');
  document.getElementById('stDepositPercent').value = currentPark.depositPercent ?? 0;
  document.getElementById('stDepositPercent').classList.add('has-value');
  renderPromoCodes(currentPark.promoCodes || []);
  renderWaitlist(data.waitlist || []);
  document.getElementById('payoutNet').textContent = formatUsd(data.payout.netOwedToParkCents);
  document.getElementById('payoutFee').textContent = formatUsd(data.payout.platformFeeCollectedCents);

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const twoNightsLater = new Date(tomorrow); twoNightsLater.setDate(twoNightsLater.getDate() + 2);
  const checkInEl = document.getElementById('bkCheckIn');
  const checkOutEl = document.getElementById('bkCheckOut');
  checkInEl.value = tomorrow.toISOString().slice(0, 10);
  checkOutEl.value = twoNightsLater.toISOString().slice(0, 10);
  checkInEl.classList.add('has-value');
  checkOutEl.classList.add('has-value');
}

/* -- stats -- */
function renderStats(stats) {
  document.getElementById('statRevenue').textContent = formatUsd(stats.totalRevenueCents);
  document.getElementById('statOutstanding').textContent = stats.outstandingBalanceCents > 0 ? `${formatUsd(stats.outstandingBalanceCents)} balance due` : '';
  document.getElementById('statOccupancy').textContent = `${stats.occupancyPercent}%`;
  document.getElementById('statAdr').textContent = formatUsd(stats.adrCents);
  document.getElementById('statBookings').textContent = stats.totalReservations;
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
      <td>
        ${formatUsd(s.nightlyRateCents)}/night
        ${(s.seasonalRates || []).map((sr) => `<div style="font-size:0.75rem; color: var(--cream-dim); margin-top:2px;">${sr.label}: ${formatUsd(sr.nightlyRateCents)}/night (${sr.startDate} → ${sr.endDate}) <button type="button" data-remove-season="${s.id}:${sr.id}" style="background:none; border:none; color:#f0a89a; cursor:pointer;">&times;</button></div>`).join('')}
      </td>
      <td style="text-align:right; white-space:nowrap;">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-site="${s.id}">Edit Rate</button>
        <button type="button" class="btn btn-ghost btn-sm" data-add-season="${s.id}">+ Season</button>
        <button type="button" class="btn btn-ghost btn-sm" data-delete-site="${s.id}">Delete</button>
      </td>
    </tr>`).join('');
}

document.getElementById('sitesTableBody').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit-site]');
  const deleteBtn = e.target.closest('[data-delete-site]');
  const addSeasonBtn = e.target.closest('[data-add-season]');
  const removeSeasonBtn = e.target.closest('[data-remove-season]');

  if (addSeasonBtn) {
    const site = currentSites.find((s) => s.id === addSeasonBtn.dataset.addSeason);
    const label = prompt('Season name (e.g. "Summer Peak", "Holiday Weekend"):', 'Peak Season');
    if (label === null) return;
    const startDate = prompt('Start date (YYYY-MM-DD):');
    if (!startDate) return;
    const endDate = prompt('End date (YYYY-MM-DD, exclusive):');
    if (!endDate) return;
    const rateInput = prompt(`Nightly rate for ${label} (current base: ${formatUsd(site.nightlyRateCents)}):`, (site.nightlyRateCents / 100).toFixed(2));
    if (rateInput === null) return;
    const dollars = parseFloat(rateInput);
    if (isNaN(dollars) || dollars <= 0) return alert('Enter a valid rate.');

    const res = await fetch('/api/admin/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'season', siteId: site.id, label, startDate, endDate, nightlyRateCents: Math.round(dollars * 100) }),
    });
    if (res.ok) loadDashboard();
    else alert((await res.json()).error || 'Could not add seasonal rate');
    return;
  }

  if (removeSeasonBtn) {
    const [siteId, seasonId] = removeSeasonBtn.dataset.removeSeason.split(':');
    if (!confirm('Remove this seasonal rate?')) return;
    const res = await fetch('/api/admin/sites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'season', siteId, seasonId }),
    });
    if (res.ok) loadDashboard();
    else alert((await res.json()).error || 'Could not remove seasonal rate');
    return;
  }

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
      <td>${(() => { const c = statusChip(r.status); return `<span class="status-chip ${c.cls}">${c.label}</span>`; })()}</td>
      <td>${formatUsd(r.totalCents)}</td>
      <td>${r.status === 'confirmed-deposit' ? formatUsd(r.balanceCents) : '—'}</td>
    </tr>`).join('');
}

/* -- waitlist -- */
function renderWaitlist(entries) {
  const tbody = document.getElementById('waitlistTableBody');
  const emptyEl = document.getElementById('waitlistEmpty');
  if (!entries.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = entries.map((w) => `
    <tr>
      <td>${w.name}</td>
      <td>${w.email}${w.phone ? ` · ${w.phone}` : ''}</td>
      <td>${w.checkIn} → ${w.checkOut}</td>
      <td style="text-align:right;"><button type="button" class="btn btn-ghost btn-sm" data-remove-waitlist="${w.id}">Remove</button></td>
    </tr>`).join('');
}

document.getElementById('waitlistTableBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-waitlist]');
  if (!btn) return;
  if (!confirm("Remove this guest from the waitlist? (Do this after you've contacted them.)")) return;
  const res = await fetch('/api/admin/dashboard', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'waitlist', entryId: btn.dataset.removeWaitlist }),
  });
  if (res.ok) loadDashboard();
  else alert((await res.json()).error || 'Could not remove waitlist entry');
});

/* -- promo codes -- */
function renderPromoCodes(promoCodes) {
  const tbody = document.getElementById('promoTableBody');
  const emptyEl = document.getElementById('promoEmpty');
  if (!promoCodes.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = promoCodes.map((p) => `
    <tr>
      <td><code>${p.code}</code></td>
      <td>${p.type === 'percent' ? `${p.value}% off` : `${formatUsd(p.value)} off`}</td>
      <td style="text-align:right;"><button type="button" class="btn btn-ghost btn-sm" data-remove-promo="${p.id}">Remove</button></td>
    </tr>`).join('');
}

document.getElementById('promoTableBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-promo]');
  if (!btn) return;
  if (!confirm('Remove this promo code?')) return;
  const res = await fetch('/api/admin/dashboard', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'promo', promoId: btn.dataset.removePromo }),
  });
  if (res.ok) { currentPark = (await res.json()).park; renderPromoCodes(currentPark.promoCodes || []); }
  else alert((await res.json()).error || 'Could not remove promo code');
});

const promoForm = document.getElementById('promoForm');
const addPromoBtn = document.getElementById('addPromoBtn');
const promoAlert = document.getElementById('promoAlert');

promoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  promoAlert.classList.remove('is-visible', 'is-success', 'is-error');
  addPromoBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: 'promo',
        code: document.getElementById('pmCode').value,
        type: document.getElementById('pmType').value,
        // Percent is stored as the raw number (10 = 10%); flat is stored in
        // cents like every other *Cents field, so convert the dollar input.
        value: document.getElementById('pmType').value === 'flat'
          ? Math.round(parseFloat(document.getElementById('pmValue').value) * 100)
          : parseFloat(document.getElementById('pmValue').value),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not add promo code');
    currentPark = data.park;
    renderPromoCodes(currentPark.promoCodes || []);
    promoForm.reset();
    promoAlert.textContent = 'Promo code added.';
    promoAlert.classList.add('is-visible', 'is-success');
  } catch (err) {
    promoAlert.textContent = err.message;
    promoAlert.classList.add('is-visible', 'is-error');
  } finally {
    addPromoBtn.disabled = false;
  }
});

/* -- park settings -- */
const settingsForm = document.getElementById('settingsForm');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsAlert = document.getElementById('settingsAlert');

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  settingsAlert.classList.remove('is-visible', 'is-success', 'is-error');
  saveSettingsBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taxRatePercent: parseFloat(document.getElementById('stTaxRate').value),
        depositPercent: parseFloat(document.getElementById('stDepositPercent').value),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save settings');
    currentPark = data.park;
    settingsAlert.textContent = 'Settings saved.';
    settingsAlert.classList.add('is-visible', 'is-success');
  } catch (err) {
    settingsAlert.textContent = err.message;
    settingsAlert.classList.add('is-visible', 'is-error');
  } finally {
    saveSettingsBtn.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
  window.location.href = 'park-login.html';
});

loadDashboard();
