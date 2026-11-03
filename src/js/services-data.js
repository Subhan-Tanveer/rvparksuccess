/**
 * RVPark Success pricing (Nov 2026): the park website is its own $300
 * product, and reservations come in two levels — Basic and Advanced (which
 * adds the GoHighLevel marketing CRM). Everything is month-to-month. A
 * level can be bought with the website added on. All prices in cents
 * (Stripe convention).
 * Keep this in sync with api/create-checkout-session.js — the serverless
 * function duplicates these entries since it runs in a separate Node
 * runtime and can't import this browser-side module directly.
 */

export const WEBSITE = {
  key: 'website',
  name: 'Park Website',
  monthly: 30000,
  commitment: 'Month-to-month',
  tagline: 'A modern website built for your park, sold on its own.',
  features: [
    'Custom website built specifically for your park',
    'Mobile responsive and SEO optimized',
    'Google Business Profile setup',
    'Monthly support and updates',
  ],
  note: 'Separate from the reservation levels: buy it on its own, or add it to either level at checkout.',
};

export const LEVELS = [
  {
    key: 'basic',
    level: 1,
    name: 'Basic Reservation System',
    monthly: 69900,
    commitment: 'Month-to-month',
    tagline: 'Take bookings online and get paid, without the phone tag.',
    features: [
      'Online booking with live site availability',
      'Sites, nightly rates and seasonal rates',
      'Secure card payments and deposits, paid out to you',
      'Automatic guest confirmations and owner notifications',
      'Reservations calendar, plus Google Calendar sync',
      'Calendar link for Hipcamp, Airbnb and VRBO',
      'Promo codes, expenses and guest records',
    ],
    note: 'No contract. Cancel anytime.',
  },
  {
    key: 'advanced',
    level: 2,
    name: 'Advanced Reservation System',
    monthly: 99700,
    commitment: 'Month-to-month',
    featured: true,
    tagline: 'Everything in Basic, plus GoHighLevel and smart pricing.',
    includesPrior: 'Everything in Basic, plus:',
    features: [
      'GoHighLevel marketing CRM: SMS and email campaigns, AI agents and social media in one place',
      'Dynamic pricing and rate optimization',
      'Occupancy forecasting and advanced analytics',
      'Booking rules: minimum stays, booking windows, cancellation policy',
      'Waitlist for sold-out dates',
    ],
    note: 'No contract. Cancel anytime.',
  },
];

// Everything a park can buy, for looking a plan key up by name/price.
export const PACKAGES = [WEBSITE, ...LEVELS];

// Plans sold before Nov 2026. Nobody can buy them now, but parks already
// on one keep it (and its features) until they change plans.
export const LEGACY_PACKAGES = [
  { key: 'website-booking', name: 'Website & Booking System', monthly: 30000 },
  { key: 'foundation', name: 'Foundation', monthly: 69500 },
  { key: 'growth', name: 'Growth', monthly: 129500 },
  { key: 'maximum', name: 'Maximum', monthly: 199500 },
];

export function planFor(key) {
  return PACKAGES.find((p) => p.key === key) || LEGACY_PACKAGES.find((p) => p.key === key) || null;
}

// Plans that include the GoHighLevel marketing CRM.
export const CRM_PLAN_KEYS = ['advanced', 'growth', 'maximum'];

// Dashboard tabs that are part of the Advanced level. Parks on Basic (or
// website only) don't see them; parks on a retired plan keep everything
// they had.
export const ADVANCED_TABS = ['pricing-intelligence', 'analytics', 'bookingRulesDashboard', 'ml-optimization', 'occupancy-forecasting', 'waitlist'];
export function hasAdvancedTabs(key) {
  return !['basic', 'website'].includes(key);
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

// One pricing card — shared by the home page and the pricing page.
export function packageCardHtml(p, ctaHtml) {
  return `
    <div class="tilt-card package-card${p.featured ? ' is-featured' : ''}${p.level ? '' : ' is-start-here'}">
      ${p.featured ? '<span class="badge-pop">Most Popular</span>' : ''}
      ${p.level ? '' : '<span class="badge-pop is-start-here">Sold Separately</span>'}
      <div class="package-level">${p.level ? `Level ${p.level} — ${p.name}` : p.name}</div>
      <div class="price">${formatUsd(p.monthly)}<span>/month</span></div>
      <div class="package-commitment is-no-commitment">${p.commitment} · No startup fee</div>
      <p class="package-tagline">${p.tagline}</p>
      ${p.includesPrior ? `<p class="includes-prior">${p.includesPrior}</p>` : ''}
      <ul>${p.features.map((f) => `<li>${CHECK}<span>${f}</span></li>`).join('')}</ul>
      ${ctaHtml}
      <p class="package-note">${p.note}</p>
    </div>`;
}

export function formatUsd(cents, { decimals = 0 } = {}) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
