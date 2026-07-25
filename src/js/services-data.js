/**
 * Three-level pricing structure for RV park owners — replaces the old
 * à la carte service catalog. All fixed prices in cents (Stripe convention).
 * Keep this in sync with api/create-checkout-session.js — the serverless
 * function duplicates these entries since it runs in a separate Node
 * runtime and can't import this browser-side module directly.
 */

export const PACKAGES = [
  {
    key: 'foundation',
    level: 1,
    name: 'Foundation',
    monthly: 69500,
    commitment: '1 year agreement required',
    noStartupFee: true,
    tagline: 'Best for parks just getting started with proper marketing',
    features: [
      'Brand new modern website built specifically for your park',
      'Direct link and integration to your existing reservation system',
      'Monthly email campaigns to your guest database',
      'Mobile responsive and SEO optimized',
      'Google Business Profile setup',
    ],
    note: 'One year agreement ensures we have enough time to build your online presence properly and deliver real results.',
  },
  {
    key: 'growth',
    level: 2,
    name: 'Growth',
    monthly: 129500,
    commitment: 'Minimum 3 month commitment',
    featured: true,
    tagline: 'Best for parks ready to grow their online presence aggressively',
    includesPrior: 'Includes everything in Foundation, plus:',
    features: [
      'Full social media management across Facebook and Instagram',
      'Daily posts and seasonal promotions',
      'AI generated content tailored to your specific park',
      'Consistent year round visibility',
    ],
    note: 'Seasonal flexibility available — pause in your slow months and resume when your busy season starts. No penalties.',
  },
  {
    key: 'maximum',
    level: 3,
    name: 'Maximum',
    monthly: 199500,
    commitment: 'Minimum 3 month commitment',
    tagline: 'Best for parks serious about maximizing revenue and value before selling',
    includesPrior: 'Includes everything in Foundation and Growth, plus:',
    features: [
      'AI Lead Scraping System — finds travelers actively searching for RV parks right now and drives them to your park before they book somewhere else',
      'Advanced guest targeting across multiple platforms',
      'Full occupancy optimization',
    ],
    note: 'Seasonal flexibility available — pause in your slow months and resume when your busy season starts. No penalties.',
  },
];

export function formatUsd(cents, { decimals = 0 } = {}) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
