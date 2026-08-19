import '../css/tokens.css';
import { initCore } from './core.js';
import { enforceGuestIdleTimeout, markGuestLoggedIn } from './guest-session.js';
import { renderDirectionsPanel } from './directions-panel.js';

initCore();

const PARK_ID = new URLSearchParams(location.search).get('park');

// Known once either a logged-in guest's session resolves, or they type an
// email into the booking form — lets the availability search recognize
// "this is my own still-pending hold" instead of showing a site as taken
// just because the same guest is retrying after an abandoned checkout.
let knownGuestEmail = '';

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* -- default dates: tomorrow -> 2 nights later -- */
const checkInEl = document.getElementById('checkIn');
const checkOutEl = document.getElementById('checkOut');
function isoDate(d) { return d.toISOString().slice(0, 10); }
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const twoNightsLater = new Date(tomorrow); twoNightsLater.setDate(twoNightsLater.getDate() + 2);
checkInEl.value = isoDate(tomorrow);
checkInEl.min = isoDate(new Date());
checkOutEl.value = isoDate(twoNightsLater);
checkOutEl.min = isoDate(tomorrow);
checkInEl.classList.add('has-value');
checkOutEl.classList.add('has-value');
checkInEl.addEventListener('change', () => { checkOutEl.min = checkInEl.value; });

/* -- checkout success/canceled banner from the redirect back off Stripe -- */
const banner = document.getElementById('resBanner');
const checkoutStatus = new URLSearchParams(location.search).get('checkout');
if (checkoutStatus === 'success') {
  banner.textContent = "You're booked! A confirmation is on its way to your email. (Demo note: this confirms once the Stripe webhook fires — see README.)";
  banner.classList.add('is-visible', 'is-success');
} else if (checkoutStatus === 'canceled') {
  banner.textContent = 'Checkout was canceled — no charge was made. Feel free to search again.';
  banner.classList.add('is-visible', 'is-canceled');
}

/* -- availability search -- */
const resultsEl = document.getElementById('resResults');
const searchBtn = document.getElementById('searchBtn');

async function searchAvailability() {
  const checkIn = checkInEl.value;
  const checkOut = checkOutEl.value;
  if (!checkIn || !checkOut) return;

  if (!PARK_ID) {
    resultsEl.innerHTML = '<div class="res-empty">No park selected — start from <a href="find-a-park.html">Find a Park</a> and pick one to book.</div>';
    return;
  }

  searchBtn.disabled = true;
  const originalLabel = searchBtn.innerHTML;
  searchBtn.innerHTML = '<span>Searching…</span>';
  resultsEl.innerHTML = '';

  try {
    const params = new URLSearchParams({ park: PARK_ID, checkIn, checkOut });
    if (knownGuestEmail) params.set('guestEmail', knownGuestEmail);
    const res = await fetch(`/api/reservations/availability?${params}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Search failed');
    }
    const data = await res.json();
    if (data.park) {
      document.getElementById('resParkHeading').textContent = `Book Your Stay at ${data.park.name}`;
      document.title = `Book a Site — ${data.park.name}`;
      // "How far is this from me" is part of deciding whether to book at
      // all, so the map shows as soon as a park is picked — not just
      // after paying. The live arrival-greeting toggle stays gated to a
      // completed checkout, though: there's nothing to "arrive at" yet,
      // and asking for location permission before that is a pointless ask.
      renderDirectionsPanel(document.getElementById('resDirections'), data.park, {
        showArrivalGreeting: checkoutStatus === 'success',
      });
    }
    renderResults(data.sites, checkIn, checkOut);
  } catch (err) {
    resultsEl.innerHTML = `<div class="res-empty">Couldn't load availability right now${err.message ? ` — ${err.message}` : ''}. Please try again in a moment.</div>`;
    console.warn('Availability search failed:', err.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.innerHTML = originalLabel;
  }
}

let lastSites = [];

// Cover photo + thumbnail strip + video, if the owner has uploaded any —
// returns '' (no markup at all) for a site with nothing uploaded yet, so
// existing cards look exactly as before this feature existed.
function siteMediaHtml(site) {
  const images = (site.media || []).filter((m) => m.type === 'image');
  const video = (site.media || []).find((m) => m.type === 'video');
  if (!images.length && !video) return '';

  const coverHtml = images.length
    ? `<img class="res-site-cover" data-site-cover src="${escapeAttr(images[0].url)}" alt="${escapeAttr(site.name)}" loading="lazy">`
    : '';
  const thumbsHtml = images.length > 1
    ? `<div class="res-site-thumbs">${images.map((m, i) => `<button type="button" class="res-site-thumb${i === 0 ? ' is-active' : ''}" data-site-thumb="${escapeAttr(m.url)}"><img src="${escapeAttr(m.url)}" alt="" loading="lazy"></button>`).join('')}</div>`
    : '';
  const videoHtml = video
    ? `<video class="res-site-video" src="${escapeAttr(video.url)}" controls preload="metadata"></video>`
    : '';

  return `<div class="res-site-media">${coverHtml}${thumbsHtml}${videoHtml}</div>`;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderResults(sites, checkIn, checkOut) {
  lastSites = sites || [];
  if (!sites || !sites.length) {
    resultsEl.innerHTML = `
      <div class="res-empty">No sites available for those dates. Try a different range, or join the waitlist below.</div>
      <div class="res-search glass dot-grid" style="max-width:480px; margin: var(--sp-4) auto 0;">
        <p class="eyebrow" style="margin-bottom: var(--sp-2);">Join the Waitlist</p>
        <form id="waitlistForm">
          <div class="field-float"><input id="wlName" required><label for="wlName">Full Name</label></div>
          <div class="field-float"><input id="wlEmail" type="email" required><label for="wlEmail">Email</label></div>
          <div class="field-float"><input id="wlPhone" type="tel"><label for="wlPhone">Phone (optional)</label></div>
          <button type="submit" class="btn btn-primary magnetic" style="width:100%; justify-content:center;" id="wlSubmitBtn"><span>Join Waitlist</span></button>
          <p class="form-note" id="wlNote" style="display:none; text-align:center;"></p>
        </form>
      </div>`;
    document.getElementById('waitlistForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('wlSubmitBtn');
      const note = document.getElementById('wlNote');
      btn.disabled = true;
      try {
        const res = await fetch('/api/reservations/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parkId: PARK_ID, checkIn, checkOut,
            name: document.getElementById('wlName').value,
            email: document.getElementById('wlEmail').value,
            phone: document.getElementById('wlPhone').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not join waitlist');
        note.textContent = "You're on the list — we'll reach out if a site opens up for those dates.";
        note.style.color = 'var(--amber-light)';
        note.style.display = 'block';
        document.getElementById('waitlistForm').reset();
      } catch (err) {
        note.textContent = err.message;
        note.style.color = '#f0a89a';
        note.style.display = 'block';
      } finally {
        btn.disabled = false;
      }
    });
    return;
  }
  resultsEl.innerHTML = `
    <div class="section-head" style="margin-bottom: var(--sp-4);">
      <p class="eyebrow">${sites.length} Site${sites.length === 1 ? '' : 's'} Available</p>
      <h2 style="font-size: 1.5rem;">${checkIn} to ${checkOut}</h2>
    </div>
    <div class="res-grid">${sites.map((s) => `
      <div class="tilt-card res-site-card">
        ${siteMediaHtml(s)}
        <h3>${s.name}</h3>
        <div class="res-site-type">${s.type}</div>
        <div class="res-site-meta">Sleeps up to ${s.capacity}</div>
        <div class="res-site-price">
          <div class="rate">${formatUsd(s.nightlyRateCents)}/night × ${s.nights} night${s.nights === 1 ? '' : 's'}</div>
          <div class="total">${formatUsd(s.totalCents)}</div>
          <div class="total-label">Total incl. ${s.taxCents > 0 ? `${s.taxRatePercent}% tax + ` : ''}booking fee</div>
          ${s.balanceCents > 0 ? `<div class="total-label" style="margin-top:2px;">Pay ${formatUsd(s.depositCents)} now · ${formatUsd(s.balanceCents)} due at check-in</div>` : ''}
        </div>
        <button type="button" class="btn btn-primary magnetic" style="width:100%; margin-top: var(--sp-3);" data-book-site="${s.id}"><span>Book This Site</span></button>
      </div>`).join('')}
    </div>`;
}

searchBtn.addEventListener('click', searchAvailability);

/* -- smart default dates: if the plain "tomorrow, 2 nights" default is
   already fully booked, silently walk forward and start the guest on the
   first date range that actually has something open, instead of greeting
   them with "No sites available" before they've touched anything. Checks
   run in small batches so a long streak of booked-out nights doesn't mean
   dozens of sequential round trips. -- */
const DEFAULT_STAY_NIGHTS = 2;
const AUTO_LOOKAHEAD_DAYS = 60;
const AUTO_LOOKAHEAD_BATCH = 7;

async function checkDateRangeHasAvailability(checkIn, checkOut) {
  try {
    const params = new URLSearchParams({ park: PARK_ID, checkIn, checkOut });
    const res = await fetch(`/api/reservations/availability?${params}`);
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data.sites && data.sites.length);
  } catch {
    return false;
  }
}

async function findFirstAvailableDates(startFrom) {
  for (let offset = 0; offset < AUTO_LOOKAHEAD_DAYS; offset += AUTO_LOOKAHEAD_BATCH) {
    const batch = [];
    for (let i = 0; i < AUTO_LOOKAHEAD_BATCH && offset + i < AUTO_LOOKAHEAD_DAYS; i++) {
      const checkIn = new Date(startFrom);
      checkIn.setDate(checkIn.getDate() + offset + i);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + DEFAULT_STAY_NIGHTS);
      batch.push({ checkIn: isoDate(checkIn), checkOut: isoDate(checkOut) });
    }
    const results = await Promise.all(
      batch.map(async (range) => ((await checkDateRangeHasAvailability(range.checkIn, range.checkOut)) ? range : null))
    );
    const found = results.find(Boolean);
    if (found) return found;
  }
  return null;
}

(async () => {
  if (PARK_ID) {
    const originalCheckIn = checkInEl.value;
    const found = await findFirstAvailableDates(tomorrow);
    if (found && found.checkIn !== originalCheckIn) {
      checkInEl.value = found.checkIn;
      checkOutEl.value = found.checkOut;
      checkOutEl.min = found.checkIn;
      const note = document.getElementById('autoDateNote');
      if (note) {
        note.textContent = `Heads up — the next couple of nights are booked, so we moved these dates to the next open slot. Pick your own dates anytime.`;
        note.style.display = 'block';
      }
    }
  }
  searchAvailability();
})();

/* -- pre-fill guest details for a logged-in guest account -- */
enforceGuestIdleTimeout().then((wentIdle) => {
  if (wentIdle) return; // idle-expired — leave the checkout form blank, same as any anonymous guest
  fetch('/api/guest').then((res) => (res.ok ? res.json() : null)).then((data) => {
    if (!data) return;
    markGuestLoggedIn();
    document.getElementById('guestName').value = data.guest.name;
    document.getElementById('guestEmail').value = data.guest.email;
    document.getElementById('guestPhone').value = data.guest.phone || '';
    document.querySelectorAll('#guestForm .field-float').forEach((field) => {
      if (field.querySelector('input')?.value) field.classList.add('has-value');
    });

    // Now that we know who's searching, re-run the search so a site only
    // this guest is holding (mid-checkout, or an abandoned one they're
    // retrying) shows up as available to them instead of "taken."
    if (data.guest.email && data.guest.email !== knownGuestEmail) {
      knownGuestEmail = data.guest.email;
      searchAvailability();
    }
  }).catch(() => {});
});

// An anonymous guest typing their own email is also enough to recognize
// their own hold on the next search/promo-check within this page session.
document.getElementById('guestEmail').addEventListener('change', (e) => {
  knownGuestEmail = e.target.value.trim();
});

/* -- guest details modal + checkout -- */
const modalBackdrop = document.getElementById('resModalBackdrop');
const modalClose = document.getElementById('resModalClose');
const modalSiteName = document.getElementById('resModalSiteName');
const modalSummary = document.getElementById('resModalSummary');
const guestForm = document.getElementById('guestForm');
const checkoutBtn = document.getElementById('resCheckoutBtn');
const checkoutSub = document.getElementById('resCheckoutSub');

let selectedSiteId = null;
let appliedPromoCode = null;

function renderModalSummary(site) {
  const balanceLine = site.balanceCents > 0
    ? `<br><b>${formatUsd(site.depositCents)}</b> due now, <b>${formatUsd(site.balanceCents)}</b> due at check-in`
    : '';
  const discountLine = site.discountCents > 0
    ? `<br><span style="color: var(--amber-light);">${site.appliedPromoCode} applied: -${formatUsd(site.discountCents)}</span>`
    : '';
  modalSummary.innerHTML = `<b>${checkInEl.value}</b> to <b>${checkOutEl.value}</b><br>${formatUsd(site.totalCents)} total, incl. booking fee${discountLine}${balanceLine}`;
}

resultsEl.addEventListener('click', (e) => {
  const thumbBtn = e.target.closest('[data-site-thumb]');
  if (thumbBtn) {
    const card = thumbBtn.closest('.res-site-card');
    const cover = card.querySelector('[data-site-cover]');
    if (cover) cover.src = thumbBtn.dataset.siteThumb;
    card.querySelectorAll('[data-site-thumb]').forEach((t) => t.classList.toggle('is-active', t === thumbBtn));
    return;
  }

  const btn = e.target.closest('[data-book-site]');
  if (!btn) return;
  selectedSiteId = btn.dataset.bookSite;
  appliedPromoCode = null;
  const card = btn.closest('.res-site-card');
  const site = lastSites.find((s) => s.id === selectedSiteId);
  modalSiteName.textContent = card.querySelector('h3').textContent;
  document.getElementById('promoCodeInput').value = '';
  document.getElementById('promoNote').style.display = 'none';
  if (site) renderModalSummary(site);
  modalBackdrop.classList.add('is-open');
});

document.getElementById('applyPromoBtn').addEventListener('click', async () => {
  const code = document.getElementById('promoCodeInput').value.trim();
  const promoNote = document.getElementById('promoNote');
  if (!code || !selectedSiteId) return;

  try {
    const params = new URLSearchParams({ park: PARK_ID, checkIn: checkInEl.value, checkOut: checkOutEl.value, promo: code });
    if (knownGuestEmail) params.set('guestEmail', knownGuestEmail);
    const res = await fetch(`/api/reservations/availability?${params}`);
    const data = await res.json();
    const site = data.sites?.find((s) => s.id === selectedSiteId);
    if (!site) throw new Error('Could not re-check pricing for that site');

    if (site.discountCents > 0) {
      appliedPromoCode = code;
      promoNote.textContent = `"${site.appliedPromoCode}" applied — you saved ${formatUsd(site.discountCents)}.`;
      promoNote.style.color = 'var(--amber-light)';
    } else {
      appliedPromoCode = null;
      promoNote.textContent = 'That code is invalid or expired.';
      promoNote.style.color = '#f0a89a';
    }
    promoNote.style.display = 'block';
    renderModalSummary(site);
  } catch (err) {
    promoNote.textContent = 'Could not apply promo code right now.';
    promoNote.style.display = 'block';
  }
});

function closeModal() { modalBackdrop.classList.remove('is-open'); }
modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

guestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedSiteId) return;

  const originalLabel = checkoutBtn.innerHTML;
  checkoutBtn.disabled = true;
  checkoutBtn.innerHTML = '<span>Redirecting…</span>';

  try {
    const res = await fetch('/api/reservations/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parkId: PARK_ID,
        siteId: selectedSiteId,
        checkIn: checkInEl.value,
        checkOut: checkOutEl.value,
        guestName: document.getElementById('guestName').value,
        guestEmail: document.getElementById('guestEmail').value,
        guestPhone: document.getElementById('guestPhone').value,
        promoCode: appliedPromoCode,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed');
    window.location.href = data.url;
  } catch (err) {
    checkoutBtn.disabled = false;
    checkoutBtn.innerHTML = originalLabel;
    checkoutSub.textContent = `Unavailable right now — ${err.message}`;
    console.warn('Reservation checkout unavailable:', err.message);
  }
});
