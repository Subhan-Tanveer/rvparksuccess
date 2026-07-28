import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

const PARK_ID = new URLSearchParams(location.search).get('park') || 'best-rv-park';

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

  searchBtn.disabled = true;
  const originalLabel = searchBtn.innerHTML;
  searchBtn.innerHTML = '<span>Searching…</span>';
  resultsEl.innerHTML = '';

  try {
    const params = new URLSearchParams({ park: PARK_ID, checkIn, checkOut });
    const res = await fetch(`/api/reservations/availability?${params}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Search failed');
    }
    const data = await res.json();
    if (data.park) {
      document.getElementById('resParkHeading').textContent = `Book Your Stay at ${data.park.name}`;
      document.title = `Book a Site — ${data.park.name}`;
    }
    renderResults(data.sites, checkIn, checkOut);
  } catch (err) {
    resultsEl.innerHTML = `<div class="res-empty">Couldn't load availability right now${err.message ? ` — ${err.message}` : ''}. (Availability only works when running under \`vercel dev\` or once deployed — plain \`npm run dev\` has no serverless runtime.)</div>`;
    console.warn('Availability search failed:', err.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.innerHTML = originalLabel;
  }
}

function renderResults(sites, checkIn, checkOut) {
  if (!sites || !sites.length) {
    resultsEl.innerHTML = '<div class="res-empty">No sites available for those dates. Try a different range.</div>';
    return;
  }
  resultsEl.innerHTML = `
    <div class="section-head" style="margin-bottom: var(--sp-4);">
      <p class="eyebrow">${sites.length} Site${sites.length === 1 ? '' : 's'} Available</p>
      <h2 style="font-size: 1.5rem;">${checkIn} to ${checkOut}</h2>
    </div>
    <div class="res-grid">${sites.map((s) => `
      <div class="tilt-card res-site-card">
        <h3>${s.name}</h3>
        <div class="res-site-type">${s.type}</div>
        <div class="res-site-meta">Sleeps up to ${s.capacity}</div>
        <div class="res-site-price">
          <div class="rate">${formatUsd(s.nightlyRateCents)}/night × ${s.nights} night${s.nights === 1 ? '' : 's'}</div>
          <div class="total">${formatUsd(s.totalCents)}</div>
          <div class="total-label">Total incl. booking fee</div>
        </div>
        <button type="button" class="btn btn-primary magnetic" style="width:100%; margin-top: var(--sp-3);" data-book-site="${s.id}"><span>Book This Site</span></button>
      </div>`).join('')}
    </div>`;
}

searchBtn.addEventListener('click', searchAvailability);
searchAvailability();

/* -- guest details modal + checkout -- */
const modalBackdrop = document.getElementById('resModalBackdrop');
const modalClose = document.getElementById('resModalClose');
const modalSiteName = document.getElementById('resModalSiteName');
const modalSummary = document.getElementById('resModalSummary');
const guestForm = document.getElementById('guestForm');
const checkoutBtn = document.getElementById('resCheckoutBtn');
const checkoutSub = document.getElementById('resCheckoutSub');

let selectedSiteId = null;

resultsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-book-site]');
  if (!btn) return;
  selectedSiteId = btn.dataset.bookSite;
  const card = btn.closest('.res-site-card');
  modalSiteName.textContent = card.querySelector('h3').textContent;
  modalSummary.innerHTML = `<b>${checkInEl.value}</b> to <b>${checkOutEl.value}</b><br>${card.querySelector('.res-site-price .total').textContent} total, incl. booking fee`;
  modalBackdrop.classList.add('is-open');
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
