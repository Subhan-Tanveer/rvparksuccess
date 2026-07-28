import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

function formatUsd(cents) {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

const locationInput = document.getElementById('locationInput');
const searchBtn = document.getElementById('fapSearchBtn');
const resultsEl = document.getElementById('fapResults');

async function search() {
  searchBtn.disabled = true;
  const originalLabel = searchBtn.innerHTML;
  searchBtn.innerHTML = '<span>Searching…</span>';
  resultsEl.innerHTML = '';

  try {
    const params = new URLSearchParams();
    if (locationInput.value.trim()) params.set('location', locationInput.value.trim());
    const res = await fetch(`/api/reservations/parks?${params}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Search failed');
    }
    const data = await res.json();
    renderResults(data.parks);
  } catch (err) {
    resultsEl.innerHTML = `<div class="fap-empty">Couldn't load parks right now${err.message ? ` — ${err.message}` : ''}. (This search only works when running under \`vercel dev\` or once deployed — plain \`npm run dev\` has no serverless runtime.)</div>`;
    console.warn('Park search failed:', err.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.innerHTML = originalLabel;
  }
}

function renderResults(parks) {
  if (!parks || !parks.length) {
    resultsEl.innerHTML = '<div class="fap-empty">No parks matched that search. Try a different city, state, or park name.</div>';
    return;
  }
  resultsEl.innerHTML = `
    <div class="section-head" style="margin-bottom: var(--sp-4);">
      <p class="eyebrow">${parks.length} Park${parks.length === 1 ? '' : 's'} Found</p>
    </div>
    <div class="fap-grid">${parks.map((p) => `
      <div class="tilt-card fap-card">
        <h3>${p.name}</h3>
        <div class="loc"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>${p.location}</div>
        <div class="types">${p.siteTypes.map((t) => `<span class="type-chip">${t}</span>`).join('')}</div>
        <div class="price-range">
          <span class="amt">${formatUsd(p.minNightlyRateCents)}</span><span class="lbl"> – ${formatUsd(p.maxNightlyRateCents)}/night · ${p.siteCount} sites</span>
        </div>
        <a href="reservations.html?park=${p.id}" class="btn btn-primary magnetic" style="width:100%; margin-top: var(--sp-3); justify-content:center;"><span>View Availability</span></a>
      </div>`).join('')}
    </div>`;
}

searchBtn.addEventListener('click', search);
locationInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
search();
