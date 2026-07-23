import '../css/tokens.css';
import { initCore, initHeroVideo } from './core.js';
import { SERVICES, formatUsd } from './services-data.js';

initCore();
initHeroVideo({ placeholderLabel: 'PRICING — HERO VIDEO COMING SOON' });

const ICONS = {
  share: '<path d="M18 8a3 3 0 1 0-2.83-4H15a3 3 0 0 0 .05.54L8.09 8.49a3 3 0 1 0 0 5.02l6.96 3.95a3 3 0 1 0 .8-1.74L8.9 11.76a3 3 0 0 0 0-1.52l6.95-3.95c.34.44.77.8 1.15 1.03A3 3 0 0 0 18 8Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
};
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

function svgIcon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ICONS.chart}</svg>`;
}

function priceRowHtml(item) {
  if (item.startingAt) {
    return `<div class="price-row is-single"><div><span class="p-starting">Starting At</span><span class="p-monthly" style="color:var(--amber-light);">${formatUsd(item.setup)}</span></div></div>`;
  }
  if (item.setup && item.monthly) {
    return `<div class="price-row"><span class="p-setup">${formatUsd(item.setup)}<span class="p-label">setup</span></span><span class="p-plus">+</span><span class="p-monthly">${formatUsd(item.monthly)}<span class="p-label">/mo</span></span></div>`;
  }
  return `<div class="price-row is-single"><span class="p-monthly">${formatUsd(item.monthly)}<span class="p-label">/mo</span></span></div>`;
}

/* -- Individual services grid: every service is its own card, its own price -- */
const servicesGrid = document.getElementById('servicesGrid');
if (servicesGrid) {
  servicesGrid.innerHTML = SERVICES.map((s) => `
    <div class="tilt-card service-card">
      <div class="ic">${svgIcon(s.icon)}</div>
      <h3>${s.name}</h3>
      <ul class="feature-list" style="margin: 0 0 var(--sp-2);">${s.desc.map((d) => `<li>${CHECK}<span style="font-size:0.875rem;">${d}</span></li>`).join('')}</ul>
      ${priceRowHtml(s)}
      ${s.monthly ? `<div class="pause-note">${PAUSE_ICON} Pause anytime — perfect for seasonal parks</div>` : ''}
      <button class="btn btn-primary btn-get-started magnetic" style="width:100%; margin-top: var(--sp-3);" data-key="${s.key}"><span>Get Started</span></button>
      ${s.disclaimer ? `<p class="service-disclaimer">${s.disclaimer}</p>` : ''}
    </div>`).join('');
}

/* -- Payment modal: works for any fixed-price service -- */
const ALL_FIXED = SERVICES;
const backdrop = document.getElementById('payModalBackdrop');
const closeBtn = document.getElementById('payModalClose');
const serviceLabel = document.getElementById('payModalService');
const headline = document.getElementById('payModalHeadline');
const breakdown = document.getElementById('payModalBreakdown');
const paypalBtn = document.getElementById('paypalBtn');
const cardBtn = document.getElementById('cardBtn');
const cardBtnSub = document.getElementById('cardBtnSub');

let selectedService = null;

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-get-started');
  if (!btn) return;
  const service = ALL_FIXED.find((s) => s.key === btn.dataset.key);
  if (!service) return;
  selectedService = service;

  serviceLabel.textContent = service.name;
  headline.textContent = service.setup && service.monthly
    ? `${formatUsd(service.setup)} setup + ${formatUsd(service.monthly)}/mo`
    : service.monthly && !service.setup
      ? `${formatUsd(service.monthly)}/mo`
      : `${service.startingAt ? 'Starting at ' : ''}${formatUsd(service.setup)}`;

  const items = [];
  if (service.setup) items.push(`<div class="item"><div class="val is-setup">${formatUsd(service.setup)}</div><div class="lbl">${service.monthly ? 'One-Time Setup' : 'One-Time'}</div></div>`);
  if (service.monthly) items.push(`<div class="item"><div class="val is-monthly">${formatUsd(service.monthly)}</div><div class="lbl">Per Month</div></div>`);
  breakdown.innerHTML = items.join('');

  const totalDollars = ((service.setup || 0) + (service.monthly || 0)) / 100;
  paypalBtn.href = `https://www.paypal.com/paypalme/rvparksuccess/${totalDollars}`;
  cardBtn.disabled = false;
  cardBtnSub.textContent = 'Secure Stripe checkout';
  backdrop.classList.add('is-open');
});

cardBtn.addEventListener('click', async () => {
  if (!selectedService) return;
  const originalLabel = cardBtn.textContent;
  cardBtn.disabled = true;
  cardBtn.textContent = 'Redirecting…';
  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: selectedService.key }),
    });
    if (!res.ok) throw new Error('checkout session request failed');
    const data = await res.json();
    if (!data.url) throw new Error('no checkout url returned');
    window.location.href = data.url;
  } catch (err) {
    // Most likely cause in local dev: /api routes only run under `vercel dev` or once deployed to Vercel.
    cardBtn.disabled = false;
    cardBtn.textContent = originalLabel;
    cardBtnSub.textContent = 'Unavailable right now — try PayPal/Zelle, or run `vercel dev` locally';
    console.warn('Stripe checkout unavailable:', err.message);
  }
});

function closeModal() { backdrop.classList.remove('is-open'); }
closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
