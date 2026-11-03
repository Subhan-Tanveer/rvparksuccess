import '../css/tokens.css';
import { initCore, initHeroVideo } from './core.js';
import { PACKAGES, LEVELS, WEBSITE, formatUsd, packageCardHtml } from './services-data.js';

initCore();
initHeroVideo({ placeholderLabel: 'PRICING — HERO VIDEO COMING SOON' });

const pkgBanner = document.getElementById('pkgBanner');
if (new URLSearchParams(location.search).get('checkout') === 'canceled') {
  pkgBanner.textContent = 'Checkout was canceled — no charge was made. Pick a level whenever you\'re ready.';
  pkgBanner.classList.add('is-visible', 'is-canceled');
}

const cta = (p) => `<button class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'} btn-get-started magnetic" data-key="${p.key}"><span>Get Started</span></button>`;

/* -- the two reservation levels, then the website on its own -- */
const packageGrid = document.getElementById('packageGrid');
if (packageGrid) packageGrid.innerHTML = LEVELS.map((p) => packageCardHtml(p, cta(p))).join('');
const websiteGrid = document.getElementById('websiteGrid');
if (websiteGrid) websiteGrid.innerHTML = packageCardHtml(WEBSITE, cta(WEBSITE));

/* -- Payment modal: Stripe Checkout only, works for any monthly-subscription package -- */
const backdrop = document.getElementById('payModalBackdrop');
const closeBtn = document.getElementById('payModalClose');
const serviceLabel = document.getElementById('payModalService');
const headline = document.getElementById('payModalHeadline');
const breakdown = document.getElementById('payModalBreakdown');
const cardBtn = document.getElementById('cardBtn');
const cardBtnSub = document.getElementById('cardBtnSub');

const addonRow = document.getElementById('websiteAddonRow');
const addonInput = document.getElementById('websiteAddon');

let selectedPackage = null;

function renderTotal() {
  const monthly = selectedPackage.monthly + (addonInput.checked ? WEBSITE.monthly : 0);
  headline.textContent = `${formatUsd(monthly)}/mo`;
  breakdown.innerHTML = `<div class="item"><div class="val is-monthly">${formatUsd(monthly)}</div><div class="lbl">Per Month${addonInput.checked ? ' (incl. website)' : ''}</div></div><div class="item"><div class="val is-setup">${selectedPackage.commitment}</div><div class="lbl">Commitment</div></div>`;
}
addonInput.addEventListener('change', renderTotal);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-get-started');
  if (!btn) return;
  const pkg = PACKAGES.find((p) => p.key === btn.dataset.key);
  if (!pkg) return;
  selectedPackage = pkg;

  // Either level can take the website as an add-on; the website itself can't.
  addonRow.hidden = !pkg.level;
  addonInput.checked = false;
  serviceLabel.textContent = pkg.level ? `Level ${pkg.level} — ${pkg.name}` : pkg.name;
  renderTotal();
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
      body: JSON.stringify({ service: selectedPackage.key, addWebsite: !!selectedPackage.level && addonInput.checked }),
    });
    if (res.status === 401) {
      // Picking a plan requires an owner account first — send them to sign
      // up, then they'll land right back here per the redirectTo logic.
      window.location.href = 'login.html';
      return;
    }
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
