import '../css/tokens.css';
import { initCore, initHeroVideo, buildMarquee } from './core.js';
import { LEVELS, packageCardHtml } from './services-data.js';

initCore();
initHeroVideo({ placeholderLabel: 'RVPARK SUCCESS — HERO VIDEO COMING SOON' });

/* -- pricing levels grid: same two levels as the pricing page -- */
const homePackageGrid = document.getElementById('homePackageGrid');
if (homePackageGrid) {
  homePackageGrid.innerHTML = LEVELS.map((p) => packageCardHtml(p, `<a href="packages.html" class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'} magnetic"><span>Learn More</span></a>`)).join('');
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
