import '../css/tokens.css';
import { initCore, initHeroVideo, buildMarquee } from './core.js';
import { SERVICES, formatUsd } from './services-data.js';

initCore();
initHeroVideo({ placeholderLabel: 'RVPARK SUCCESS — HERO VIDEO COMING SOON' });

/* -- individual services grid (mirrors packages.js's rendering) -- */
const HOME_ICONS = {
  share: '<path d="M18 8a3 3 0 1 0-2.83-4H15a3 3 0 0 0 .05.54L8.09 8.49a3 3 0 1 0 0 5.02l6.96 3.95a3 3 0 1 0 .8-1.74L8.9 11.76a3 3 0 0 0 0-1.52l6.95-3.95c.34.44.77.8 1.15 1.03A3 3 0 0 0 18 8Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
};
const HOME_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const HOME_PAUSE = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

const homeServicesGrid = document.getElementById('homeServicesGrid');
if (homeServicesGrid) {
  homeServicesGrid.innerHTML = SERVICES.map((s) => {
    let priceHtml;
    if (s.startingAt) {
      priceHtml = `<div class="price-row is-single"><div><span class="p-starting">Starting At</span><span class="p-monthly" style="color:var(--amber-light);">${formatUsd(s.setup)}</span></div></div>`;
    } else if (s.setup && s.monthly) {
      priceHtml = `<div class="price-row"><span class="p-setup">${formatUsd(s.setup)}<span class="p-label">setup</span></span><span class="p-plus">+</span><span class="p-monthly">${formatUsd(s.monthly)}<span class="p-label">/mo</span></span></div>`;
    } else {
      priceHtml = `<div class="price-row is-single"><span class="p-monthly">${formatUsd(s.monthly)}<span class="p-label">/mo</span></span></div>`;
    }
    return `
    <div class="tilt-card service-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${HOME_ICONS[s.icon] || HOME_ICONS.chart}</svg></div>
      <h3>${s.name}</h3>
      <ul class="feature-list" style="list-style:none; padding:0; margin: 0 0 var(--sp-2); display:flex; flex-direction:column; gap:8px;">${s.desc.map((d) => `<li style="display:flex; gap:8px; align-items:flex-start;">${HOME_CHECK}<span style="font-size:0.8125rem; color:var(--cream-dim);">${d}</span></li>`).join('')}</ul>
      ${priceHtml}
      ${s.monthly ? `<div class="pause-note">${HOME_PAUSE} Pause anytime — perfect for seasonal parks</div>` : ''}
      <a href="packages.html" class="btn btn-primary magnetic" style="width:100%; margin-top: var(--sp-3); justify-content:center;"><span>Get Started</span></a>
    </div>`;
  }).join('');
}

/* -- recently-updated marquee -- */
const marqueeTrack = document.getElementById('marqueeTrack');
if (marqueeTrack) {
  const items = [
    'Pine Glen RV Park — Occupancy Up 31%',
    'Cedar Bend Campground — Booked Out 3 Weekends Early',
    'Blue Ridge RV Resort — Value Added $380K',
    'Timber Trail Park — Occupancy Up 27%',
    'Lakeview RV Village — Sold Above Asking',
    'Mesa Verde Camp — Occupancy Up 42%',
  ].map((t) => {
    const [name, stat] = t.split(' — ');
    return `<span class="marquee-item"><span class="dot"></span>${name} <b>— ${stat}</b></span>`;
  });
  buildMarquee(marqueeTrack, items);
}
