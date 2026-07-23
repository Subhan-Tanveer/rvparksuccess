import '../css/tokens.css';
import { initCore, initHeroVideo, ScrollTrigger, prefersReduced } from './core.js';

initCore();
initHeroVideo({ placeholderLabel: 'RESULTS — HERO VIDEO COMING SOON' });

/* -- animated occupancy graph: bars grow to their data-height when scrolled into view -- */
const graph = document.getElementById('occGraph');
if (graph) {
  const bars = [...graph.querySelectorAll('.bar')];
  if (prefersReduced) {
    bars.forEach((b) => { b.style.height = `${b.dataset.height}%`; });
  } else {
    ScrollTrigger.create({
      trigger: graph, start: 'top 80%', once: true,
      onEnter: () => bars.forEach((b, i) => {
        setTimeout(() => { b.style.height = `${b.dataset.height}%`; }, i * 120);
      }),
    });
  }
}

/* -- case study image: falls back to a generated placeholder if not supplied yet -- */
const caseImg = document.getElementById('caseImg');
if (caseImg) {
  caseImg.addEventListener('error', () => {
    caseImg.src =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#102e32"/><text x="40" y="560" font-family="Georgia,serif" font-size="26" fill="#f5f0e8cc">Pine Glen RV Park — photo coming soon</text></svg>`
      );
  }, { once: true });
}
