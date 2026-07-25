import '../css/tokens.css';
import { initCore, initHeroVideo } from './core.js';
import { PACKAGES, formatUsd } from './services-data.js';

initCore();
initHeroVideo({ placeholderLabel: 'PRICING — HERO VIDEO COMING SOON' });

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/* -- Three-level pricing grid -- */
const packageGrid = document.getElementById('packageGrid');
if (packageGrid) {
  packageGrid.innerHTML = PACKAGES.map((p) => `
    <div class="tilt-card package-card${p.featured ? ' is-featured' : ''}">
      ${p.featured ? '<span class="badge-pop">Most Popular</span>' : ''}
      <div class="package-level">Level ${p.level} — ${p.name}</div>
      <div class="price">${formatUsd(p.monthly)}<span>/month</span></div>
      <div class="package-commitment">${p.commitment}${p.noStartupFee ? ' · No startup fee' : ''}</div>
      <p class="package-tagline">${p.tagline}</p>
      ${p.includesPrior ? `<p class="includes-prior">${p.includesPrior}</p>` : ''}
      <ul>${p.features.map((f) => `<li>${CHECK}<span>${f}</span></li>`).join('')}</ul>
      <button class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'} btn-get-started magnetic" data-key="${p.key}"><span>Get Started</span></button>
      <p class="package-note">${p.note}</p>
    </div>`).join('');
}

/* -- Payment modal: Stripe Checkout only, works for any monthly-subscription package -- */
const backdrop = document.getElementById('payModalBackdrop');
const closeBtn = document.getElementById('payModalClose');
const serviceLabel = document.getElementById('payModalService');
const headline = document.getElementById('payModalHeadline');
const breakdown = document.getElementById('payModalBreakdown');
const cardBtn = document.getElementById('cardBtn');
const cardBtnSub = document.getElementById('cardBtnSub');

let selectedPackage = null;

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-get-started');
  if (!btn) return;
  const pkg = PACKAGES.find((p) => p.key === btn.dataset.key);
  if (!pkg) return;
  selectedPackage = pkg;

  serviceLabel.textContent = `Level ${pkg.level} — ${pkg.name}`;
  headline.textContent = `${formatUsd(pkg.monthly)}/mo`;

  breakdown.innerHTML = `<div class="item"><div class="val is-monthly">${formatUsd(pkg.monthly)}</div><div class="lbl">Per Month</div></div><div class="item"><div class="val is-setup">${pkg.commitment}</div><div class="lbl">Commitment</div></div>`;

  cardBtn.disabled = false;
  cardBtnSub.textContent = 'Secure payment powered by Stripe';
  backdrop.classList.add('is-open');
});

cardBtn.addEventListener('click', async () => {
  if (!selectedPackage) return;
  const originalLabel = cardBtn.textContent;
  cardBtn.disabled = true;
  cardBtn.textContent = 'Redirecting…';
  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: selectedPackage.key }),
    });
    if (!res.ok) throw new Error('checkout session request failed');
    const data = await res.json();
    if (!data.url) throw new Error('no checkout url returned');
    window.location.href = data.url;
  } catch (err) {
    // Most likely cause in local dev: /api routes only run under `vercel dev` or once deployed to Vercel.
    cardBtn.disabled = false;
    cardBtn.textContent = originalLabel;
    cardBtnSub.textContent = 'Checkout unavailable right now — please try again shortly.';
    console.warn('Stripe checkout unavailable:', err.message);
  }
});

function closeModal() { backdrop.classList.remove('is-open'); }
closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
