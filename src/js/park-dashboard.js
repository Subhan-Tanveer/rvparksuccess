import '../css/tokens.css';
import { initCore } from './core.js';
import { confirmDialog, formDialog, alertDialog, withLoading } from './ui-dialogs.js';
import { PACKAGES, formatUsd as formatUsdWhole } from './services-data.js';
import { initPricingDashboard } from './pricing-dashboard.js';
import AnalyticsDashboard from './analytics-dashboard.js';
import { initCrmDashboard } from './crm-dashboard.js';
import { initExpensesDashboard } from './expenses-dashboard.js';
import { initParkMediaPanel } from './park-media-panel.js';

// Common RV park amenities — a fixed checklist rather than free text, so
// this stays scannable for a guest deciding whether to book (a wall of
// custom phrases is harder to skim than a short list of icons/labels).
const PARK_FEATURES = [
  'Full Hookups', 'Pull-Through Sites', 'Wifi', 'Pool', 'Hot Tub',
  'Pet Friendly', 'Dog Park', 'Playground', 'Fishing', 'Boat Ramp',
  'Clubhouse', 'General Store', 'Laundry', 'Propane', 'Cable TV',
  'ADA Accessible', 'Dump Station', 'Fitness Center', 'Restrooms & Showers', 'Firewood For Sale',
];
import { loadGoogleMaps } from './google-maps-loader.js';
// Campaigns, Social Media, and Competitors are intentionally not wired
// into the dashboard nav — the Marketing CRM (GoHighLevel) tab below covers
// that ground for Growth/Maximum plans instead. Those modules are still on
// disk (campaigns-dashboard.js, social-dashboard.js,
// competitive-intelligence-dashboard.js) in case we bring them back. The
// native CRM (guest profiles/tags/risk-scoring, not marketing) is its own
// thing and stays wired in regardless of plan.
import { initBookingRulesDashboard } from './booking-rules-dashboard.js';
import { initMLOptimizationDashboard } from './ml-optimization-dashboard.js';
import { initializeOccupancyForecastingDashboard } from './occupancy-forecasting-dashboard.js';

initCore();

/* -- dashboard sidebar: tab-style section switching, off-canvas toggle on
   narrow viewports -- */
function initDashboardSidebar() {
  const sidebar = document.getElementById('dashSidebar');
  const toggle = document.getElementById('dashSidebarToggle');
  const backdrop = document.getElementById('dashSidebarBackdrop');
  const links = Array.from(document.querySelectorAll('#dashSidebarNav a'));
  if (!sidebar || !links.length) return;

  const closeSidebar = () => {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-visible');
    toggle?.setAttribute('aria-expanded', 'false');
  };
  const openSidebar = () => {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-visible');
    toggle?.setAttribute('aria-expanded', 'true');
  };

  toggle?.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  });
  backdrop?.addEventListener('click', closeSidebar);

  const sections = links
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (!sections.length) return;

  const setActive = (id) => {
    links.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`));
  };

  const scrollContentToTop = () => {
    const scrollable = document.querySelector('.admin-wrap');
    if (scrollable) scrollable.scrollTo(0, 0);
    window.scrollTo(0, 0);
  };

  const showSection = (id) => {
    const target = document.getElementById(id);
    if (!target) return false;
    sections.forEach((section) => section.classList.toggle('is-active', section === target));
    setActive(id);
    scrollContentToTop();

    // The "Advanced Analytics" section's canvases size themselves from
    // their container's rendered width, which is 0 while display:none.
    // Force a redraw now that the section is actually visible.
    if (id === 'analytics' && window.__analyticsDashboard) {
      window.__analyticsDashboard.redrawCharts();
    }
    // Same 0-width-while-hidden issue for the ML Rate Optimization tab's
    // elasticity curve SVG.
    if (id === 'ml-optimization' && window.__mlOptimizationDashboard) {
      window.__mlOptimizationDashboard.redrawCharts();
    }
    // Same 0-width-while-hidden issue for the Occupancy Forecasting tab's
    // 90-Day Forecast canvas.
    if (id === 'occupancy-forecasting' && window.__occupancyForecastingDashboard) {
      window.__occupancyForecastingDashboard.redrawCharts();
    }
    return true;
  };

  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      e.preventDefault();
      if (showSection(id)) {
        history.replaceState(null, '', `#${id}`);
      }
      closeSidebar();
    });
  });

  // Deep-link support: honor a bookmarked/shared #hash on load, otherwise
  // default to the first section (Overview).
  const initialId = location.hash.replace('#', '');
  const hasInitial = initialId && sections.some((section) => section.id === initialId);
  showSection(hasInitial ? initialId : sections[0].id);
}
initDashboardSidebar();

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

/* -- subscription management -- */
let subscriptionDetails = null;

function renderSubscriptionDetails(details) {
  if (!currentPark.stripeSubscriptionId || !details) {
    document.getElementById('subscriptionBox').style.display = 'none';
    return;
  }

  const loadingEl = document.getElementById('subscriptionLoading');
  const canceledEl = document.getElementById('subscriptionCanceled');
  const detailsEl = document.getElementById('subscriptionDetails');
  loadingEl.style.display = 'none';

  if (details.status === 'canceled') {
    detailsEl.style.display = 'none';
    canceledEl.style.display = 'block';
    return;
  }
  canceledEl.style.display = 'none';

  const pkg = PACKAGES.find((p) => p.key === currentPark.planKey);
  document.getElementById('subPlanName').textContent = pkg ? pkg.name : 'Unknown Plan';
  document.getElementById('subNextBilling').textContent = new Date(details.currentPeriodEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('subPaymentMethod').textContent = `Payment method: ${details.paymentMethodLast4 ? `••••${details.paymentMethodLast4}` : 'Not available'}`;

  detailsEl.style.display = 'block';
}

/* -- load everything on page open -- */
async function loadDashboard() {
  const res = await fetch('/api/admin/dashboard');
  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }
  const data = await res.json();
  currentPark = data.park;
  currentSites = data.sites;

  // Reached the dashboard before finishing onboarding (e.g. an old
  // bookmark, or navigating back mid-signup) — send them to wherever
  // they actually left off instead of rendering a half-empty dashboard.
  if (!currentPark.name) {
    window.location.href = currentPark.planKey ? 'register-park.html' : 'packages.html';
    return;
  }

  // Phase 4: Multi-Property Management — if user has 2+ parks,
  // redirect to portfolio dashboard for property selection/management
  if (data.propertiesCount && data.propertiesCount > 1) {
    window.location.href = 'portfolio-dashboard.html';
    return;
  }

  document.getElementById('gate').style.display = 'block';
  document.getElementById('parkNameHeading').textContent = `${currentPark.name} — Staff`;
  renderPlan(currentPark.planKey);
  subscriptionDetails = data.subscriptionDetails;
  renderSubscriptionDetails(subscriptionDetails);
  renderSites(currentSites);
  renderReservations(data.reservations);
  renderStats(data.stats);
  renderUpgradeNudge(currentPark, data.stats);
  document.getElementById('stTaxRate').value = currentPark.taxRatePercent ?? 0;
  document.getElementById('stTaxRate').classList.add('has-value');
  const stAddressEl = document.getElementById('stAddress');
  if (currentPark.address) {
    stAddressEl.value = currentPark.address;
    stAddressEl.classList.add('has-value');
  }
  parkAddressLatLng = currentPark.latitude != null && currentPark.longitude != null
    ? { lat: currentPark.latitude, lng: currentPark.longitude }
    : null;
  initParkAddressAutocomplete(stAddressEl);
  document.getElementById('stDescription').value = currentPark.description || '';
  if (currentPark.description) document.getElementById('stDescription').classList.add('has-value');
  renderParkFeaturesChecklist(currentPark.features || []);
  initParkMediaPanel('parkMediaPanel', currentPark);
  renderPromoCodes(currentPark.promoCodes || []);
  renderWaitlist(data.waitlist || []);
  document.getElementById('payoutNet').textContent = formatUsd(data.payout.netOwedToParkCents);
  document.getElementById('payoutFee').textContent = formatUsd(data.payout.platformFeeCollectedCents);
  renderStripeStatus(data.stripeStatus);

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const twoNightsLater = new Date(tomorrow); twoNightsLater.setDate(twoNightsLater.getDate() + 2);
  const checkInEl = document.getElementById('bkCheckIn');
  const checkOutEl = document.getElementById('bkCheckOut');
  checkInEl.value = tomorrow.toISOString().slice(0, 10);
  checkOutEl.value = twoNightsLater.toISOString().slice(0, 10);
  checkInEl.classList.add('has-value');
  checkOutEl.classList.add('has-value');

  // Initialize pricing dashboard
  await initPricingDashboard(currentPark);

  // Initialize analytics dashboard
  const analyticsDashboard = new AnalyticsDashboard('analyticsDashboard');
  await analyticsDashboard.init();
  // Exposed so initDashboardSidebar() can force a chart redraw when the
  // Advanced Analytics tab becomes visible (its canvases render at 0x0
  // while the section is display:none).
  window.__analyticsDashboard = analyticsDashboard;

  renderGhlCrmTab(currentPark);

  // Initialize the native guest CRM (profiles, tags, risk scoring) —
  // separate from the Marketing CRM tab above, which just links out to
  // GoHighLevel.
  await initCrmDashboard(currentPark);

  // Initialize expenses + Net Operating Income
  await initExpensesDashboard('expensesDashboard');

  // Initialize booking rules dashboard
  initBookingRulesDashboard();

  // Initialize ML optimization dashboard
  const mlOptimizationDashboard = await initMLOptimizationDashboard(currentPark.id, currentSites);
  // Exposed so initDashboardSidebar() can force a chart redraw when the
  // ML Rate Optimization tab becomes visible (its elasticity curve SVG
  // renders at 0x0 while the section is display:none).
  window.__mlOptimizationDashboard = mlOptimizationDashboard;

  // Initialize occupancy forecasting dashboard
  const occupancyForecastingDashboard = await initializeOccupancyForecastingDashboard();
  // Exposed so initDashboardSidebar() can force a chart redraw when the
  // Occupancy Forecasting tab becomes visible (its 90-Day Forecast canvas
  // renders at 0x0 while the section is display:none).
  window.__occupancyForecastingDashboard = occupancyForecastingDashboard;
}

/* -- Marketing CRM (GoHighLevel) tab — Growth/Maximum plans only -- */
const CRM_ELIGIBLE_PLAN_KEYS = ['growth', 'maximum'];

function renderGhlCrmTab(park) {
  const navLink = document.getElementById('navGhlCrm');
  const box = document.getElementById('ghlCrmBox');
  if (!navLink || !box) return;

  if (!CRM_ELIGIBLE_PLAN_KEYS.includes(park.planKey)) {
    navLink.style.display = 'none';
    return;
  }
  navLink.style.display = '';

  // Only http(s) is a safe navigation target for a link built from
  // admin-supplied text — javascript: or data: URLs would execute on click.
  let isSafeUrl = false;
  try { isSafeUrl = ['http:', 'https:'].includes(new URL(park.ghlCrmUrl).protocol); } catch { /* not a valid absolute URL */ }

  if (park.ghlCrmUrl && isSafeUrl) {
    box.innerHTML = `
      <p class="sub" style="margin-bottom: var(--sp-3);">Your CRM is ready — send SMS/email campaigns, run AI agents, and manage your social media all in one place.</p>
    `;
    // Built via DOM APIs, not string-concatenated HTML — ghlCrmUrl is
    // admin-supplied but still untrusted at render time. setAttribute()
    // can't be broken out of the way a template-literal href="${...}"
    // could (a stray `"` in the URL would otherwise inject attributes).
    const link = document.createElement('a');
    link.className = 'btn btn-primary';
    link.target = '_blank';
    link.rel = 'noopener';
    link.href = park.ghlCrmUrl;
    const label = document.createElement('span');
    label.textContent = 'Open Your CRM';
    link.appendChild(label);
    box.appendChild(link);
  } else {
    box.innerHTML = `
      <p class="sub">Your CRM is being set up and will be available soon. We'll email you access details once it's ready.</p>
    `;
  }
}

/* -- upgrade nudge: entry-plan owners who already have real bookings get
   pointed at the paid marketing tiers instead of us hoping they notice
   packages.html on their own -- */
const UPGRADE_NUDGE_BOOKING_THRESHOLD = 3;

function renderUpgradeNudge(park, stats) {
  const el = document.getElementById('upgradeNudge');
  if (!el) return;

  const dismissKey = `rvps_upgrade_nudge_dismissed_${park.id}`;
  const eligible = park.planKey === 'website-booking' && (stats.totalReservations || 0) >= UPGRADE_NUDGE_BOOKING_THRESHOLD;
  if (!eligible || localStorage.getItem(dismissKey)) {
    el.style.display = 'none';
    return;
  }

  el.innerHTML = `
    <p>You're getting real bookings — ${stats.totalReservations} so far. Ready to add marketing and grow faster?</p>
    <div class="upgrade-nudge-actions">
      <a href="packages.html" class="btn btn-primary btn-sm"><span>See Growth Plans</span></a>
      <button type="button" class="upgrade-nudge-dismiss" aria-label="Dismiss">&times;</button>
    </div>
  `;
  el.style.display = 'flex';
  el.querySelector('.upgrade-nudge-dismiss').addEventListener('click', () => {
    localStorage.setItem(dismissKey, '1');
    el.style.display = 'none';
  });
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
    const values = await formDialog({
      title: `Add Seasonal Rate — ${site.name}`,
      submitLabel: 'Add Season',
      fields: [
        { id: 'label', label: 'Season Name (e.g. "Summer Peak")', value: 'Peak Season' },
        { id: 'startDate', label: 'Start Date', type: 'date' },
        { id: 'endDate', label: 'End Date (exclusive)', type: 'date' },
        { id: 'rate', label: 'Nightly Rate ($)', type: 'number', step: '0.01', min: 0.01, value: (site.nightlyRateCents / 100).toFixed(2) },
      ],
    });
    if (!values) return;

    await withLoading(addSeasonBtn, async () => {
      const res = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'season', siteId: site.id, label: values.label, startDate: values.startDate, endDate: values.endDate, nightlyRateCents: Math.round(values.rate * 100) }),
      });
      if (res.ok) loadDashboard();
      else siteAlertShow((await res.json()).error || 'Could not add seasonal rate');
    });
    return;
  }

  if (removeSeasonBtn) {
    const [siteId, seasonId] = removeSeasonBtn.dataset.removeSeason.split(':');
    const ok = await confirmDialog({ title: 'Remove Seasonal Rate', message: 'Remove this seasonal rate?', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await withLoading(removeSeasonBtn, async () => {
      const res = await fetch('/api/admin/dashboard', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'season', siteId, seasonId }),
      });
      if (res.ok) loadDashboard();
      else siteAlertShow((await res.json()).error || 'Could not remove seasonal rate');
    });
    return;
  }

  if (editBtn) {
    const site = currentSites.find((s) => s.id === editBtn.dataset.editSite);
    const values = await formDialog({
      title: `Edit Rate — ${site.name}`,
      submitLabel: 'Save Rate',
      fields: [{ id: 'rate', label: 'Nightly Rate ($)', type: 'number', step: '0.01', min: 0.01, value: (site.nightlyRateCents / 100).toFixed(2) }],
    });
    if (!values) return;

    await withLoading(editBtn, async () => {
      const res = await fetch('/api/admin/dashboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'site', id: site.id, nightlyRateCents: Math.round(values.rate * 100) }),
      });
      if (res.ok) loadDashboard();
      else siteAlertShow((await res.json()).error || 'Could not update site');
    });
  }

  if (deleteBtn) {
    const site = currentSites.find((s) => s.id === deleteBtn.dataset.deleteSite);
    const ok = await confirmDialog({ title: 'Delete Site', message: `Delete ${site.name}? This can't be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await withLoading(deleteBtn, async () => {
      const res = await fetch('/api/admin/dashboard', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'site', id: site.id }),
      });
      if (res.ok) loadDashboard();
      else siteAlertShow((await res.json()).error || 'Could not delete site');
    });
  }
});

function siteAlertShow(message) {
  siteAlert.textContent = message;
  siteAlert.classList.remove('is-success');
  siteAlert.classList.add('is-visible', 'is-error');
}

/* -- add site -- */
const addSiteForm = document.getElementById('addSiteForm');
const addSiteBtn = document.getElementById('addSiteBtn');
const siteAlert = document.getElementById('siteAlert');

addSiteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  siteAlert.classList.remove('is-visible', 'is-success', 'is-error');

  await withLoading(addSiteBtn, async () => {
    try {
      const res = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'site',
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
    }
  });
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

  await withLoading(confirmBookingBtn, async () => {
    try {
      const res = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: 'staff-booking',
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
    }
  });
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
  const ok = await confirmDialog({
    title: 'Remove from Waitlist',
    message: "Remove this guest from the waitlist? Do this after you've contacted them.",
    confirmLabel: 'Remove', danger: true,
  });
  if (!ok) return;
  await withLoading(btn, async () => {
    const res = await fetch('/api/admin/dashboard', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'waitlist', entryId: btn.dataset.removeWaitlist }),
    });
    if (res.ok) loadDashboard();
    else await alertDialog({ title: 'Error', message: (await res.json()).error || 'Could not remove waitlist entry' });
  });
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
  const ok = await confirmDialog({ title: 'Remove Promo Code', message: 'Remove this promo code?', confirmLabel: 'Remove', danger: true });
  if (!ok) return;
  await withLoading(btn, async () => {
    const res = await fetch('/api/admin/dashboard', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'promo', promoId: btn.dataset.removePromo }),
    });
    if (res.ok) { currentPark = (await res.json()).park; renderPromoCodes(currentPark.promoCodes || []); }
    else await alertDialog({ title: 'Error', message: (await res.json()).error || 'Could not remove promo code' });
  });
});

const promoForm = document.getElementById('promoForm');
const addPromoBtn = document.getElementById('addPromoBtn');
const promoAlert = document.getElementById('promoAlert');

promoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  promoAlert.classList.remove('is-visible', 'is-success', 'is-error');

  await withLoading(addPromoBtn, async () => {
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
    }
  });
});

/* -- park settings -- */
const settingsForm = document.getElementById('settingsForm');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsAlert = document.getElementById('settingsAlert');

// Set by initParkAddressAutocomplete() when the owner picks a real place
// from the dropdown — null if they've only typed free text (no pin to
// save yet) or haven't touched the field. Persisted alongside the tax
// rate on the same form/submit so there's no separate save action to
// forget.
let parkAddressLatLng = null;

function initParkAddressAutocomplete(inputEl) {
  loadGoogleMaps()
    .then((maps) => {
      const autocomplete = new maps.places.Autocomplete(inputEl, { fields: ['formatted_address', 'geometry', 'name'] });
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry?.location) {
          // User hit Enter without picking a suggestion — no coordinates
          // to save, so don't silently keep a stale pin from before.
          parkAddressLatLng = null;
          return;
        }
        inputEl.value = place.formatted_address || place.name || inputEl.value;
        inputEl.classList.add('has-value');
        parkAddressLatLng = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      });
    })
    .catch((err) => console.error('Address autocomplete unavailable:', err.message));
}

function renderParkFeaturesChecklist(selectedFeatures) {
  const grid = document.getElementById('stFeaturesGrid');
  grid.innerHTML = PARK_FEATURES.map((feature) => `
    <label class="park-feature-check">
      <input type="checkbox" value="${feature}" ${selectedFeatures.includes(feature) ? 'checked' : ''}>
      <span>${feature}</span>
    </label>`).join('');
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  settingsAlert.classList.remove('is-visible', 'is-success', 'is-error');

  await withLoading(saveSettingsBtn, async () => {
    try {
      const addressValue = document.getElementById('stAddress').value.trim();
      const selectedFeatures = Array.from(document.querySelectorAll('#stFeaturesGrid input:checked')).map((el) => el.value);
      const res = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxRatePercent: parseFloat(document.getElementById('stTaxRate').value),
          description: document.getElementById('stDescription').value,
          features: selectedFeatures,
          // Only send address if the field actually has a value — matches
          // updateParkSettings' "field !== undefined means update it"
          // convention, so leaving the address blank never wipes it.
          ...(addressValue
            ? { address: addressValue, latitude: parkAddressLatLng?.lat ?? currentPark.latitude ?? null, longitude: parkAddressLatLng?.lng ?? currentPark.longitude ?? null }
            : {}),
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
    }
  });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
  window.location.href = 'login.html';
});

/* -- subscription management -- */
document.getElementById('updatePaymentBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/admin/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'subscription', action: 'portal' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not open billing portal');
    window.location.href = data.url;
  } catch (err) {
    await alertDialog({ title: 'Error', message: err.message });
  }
});

document.getElementById('cancelSubscriptionBtn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Cancel Subscription',
    message: 'Are you sure? Your billing will stop immediately and you\'ll need to pick a plan again to keep using the dashboard.',
    confirmLabel: 'Cancel Subscription', cancelLabel: 'Keep It', danger: true,
  });
  if (!ok) return;

  await withLoading(document.getElementById('cancelSubscriptionBtn'), async () => {
    try {
      const res = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'subscription', action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel subscription');
      await alertDialog({ title: 'Success', message: 'Your subscription has been canceled.' });
      window.location.href = 'park-dashboard.html';
    } catch (err) {
      await alertDialog({ title: 'Error', message: err.message });
    }
  });
});

/* -- current plan -- */
function renderPlan(planKey) {
  const el = document.getElementById('planBadge');
  if (!el) return;
  const pkg = PACKAGES.find((p) => p.key === planKey);
  el.textContent = pkg ? `${pkg.name} — ${formatUsdWhole(pkg.monthly)}/mo` : 'No active plan';
}

/* -- Stripe Connect (automated payouts) -- */
function renderStripeStatus(status) {
  const notConnected = document.getElementById('stripeNotConnected');
  const connecting = document.getElementById('stripeConnecting');
  const ready = document.getElementById('stripeReady');
  notConnected.style.display = 'none';
  connecting.style.display = 'none';
  ready.style.display = 'none';

  if (status.payoutsEnabled) ready.style.display = 'block';
  else if (status.connected) connecting.style.display = 'block';
  else notConnected.style.display = 'block';
}

async function startStripeOnboarding(btn) {
  const alertEl = document.getElementById('stripeConnectAlert');
  alertEl?.classList.remove('is-visible', 'is-success', 'is-error');
  await withLoading(btn, async () => {
    try {
      const res = await fetch('/api/admin/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'stripe-connect' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Stripe onboarding');
      window.location.href = data.url;
    } catch (err) {
      if (alertEl) {
        alertEl.textContent = err.message;
        alertEl.classList.add('is-visible', 'is-error');
      }
    }
  });
}

document.getElementById('stripeConnectBtn').addEventListener('click', (e) => startStripeOnboarding(e.currentTarget));
document.getElementById('stripeContinueBtn').addEventListener('click', (e) => startStripeOnboarding(e.currentTarget));

loadDashboard();
