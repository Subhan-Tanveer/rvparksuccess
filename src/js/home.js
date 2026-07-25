import '../css/tokens.css';
import { initCore, initHeroVideo, buildMarquee } from './core.js';
import { PACKAGES, formatUsd } from './services-data.js';

initCore();
initHeroVideo({ placeholderLabel: 'RVPARK SUCCESS — HERO VIDEO COMING SOON' });

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/* -- pricing levels grid: same three-level structure as the pricing page -- */
const homePackageGrid = document.getElementById('homePackageGrid');
if (homePackageGrid) {
  homePackageGrid.innerHTML = PACKAGES.map((p) => `
    <div class="tilt-card package-card${p.featured ? ' is-featured' : ''}">
      ${p.featured ? '<span class="badge-pop">Most Popular</span>' : ''}
      <div class="package-level">Level ${p.level} — ${p.name}</div>
      <div class="price">${formatUsd(p.monthly)}<span>/month</span></div>
      <div class="package-commitment">${p.commitment}${p.noStartupFee ? ' · No startup fee' : ''}</div>
      <p class="package-tagline">${p.tagline}</p>
      ${p.includesPrior ? `<p class="includes-prior">${p.includesPrior}</p>` : ''}
      <ul>${p.features.map((f) => `<li>${CHECK}<span>${f}</span></li>`).join('')}</ul>
      <a href="packages.html" class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'} magnetic"><span>Learn More</span></a>
      <p class="package-note">${p.note}</p>
    </div>`).join('');
}

/* -- recently-updated marquee -- */
const marqueeTrack = document.getElementById('marqueeTrack');
if (marqueeTrack) {
  const items = [
    'Best RV Park — Occupancy Up 31%',
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
