/**
 * Individual à la carte services for RV park owners — no bundled tiers.
 * All fixed prices in cents (Stripe convention). Keep this in sync with
 * api/create-checkout-session.js — the serverless function duplicates
 * these entries since it runs in a separate Node runtime and can't
 * import this browser-side module directly.
 */

export const WEBSITE_TIERS = [
  {
    key: 'website-basic',
    name: 'Website Design — Basic',
    setup: 185000,
    startingAt: true,
    desc: 'A modern, mobile-friendly website built specifically for your RV park.',
    features: [
      'Modern mobile-friendly website',
      'AI chatbot included',
      'Reservation system connection',
      'SEO optimization',
      'Google Maps integration',
      'Google Business Profile setup',
      'Contact forms',
      'Analytics setup',
    ],
  },
  {
    key: 'website-premium',
    name: 'Website Design — Premium',
    setup: 340000,
    startingAt: true,
    featured: true,
    desc: 'Everything in Basic, plus a deeper build for parks that want the full conversion engine.',
    features: [
      'Everything in Basic, plus:',
      'Advanced AI chatbot',
      'AI-powered lead capture',
      'Multiple pages',
      'Premium bespoke design',
      'Advanced SEO & local optimization',
      'Conversion rate optimization',
      'Priority support',
      '90-day post-launch optimization',
    ],
  },
];

export const SERVICES = [
  {
    key: 'ai-setter',
    name: 'AI Setter System',
    icon: 'target',
    monthly: 249700, // PROPOSED — combines the old Guest Finder ($1,297) + Booking System ($457) + Reporting ($97) + Reviews ($197) = $2,048 raw sum, priced up to reflect the bundle. Confirm/adjust this number.
    desc: [
      'AI finds travelers actively planning RV trips across Facebook, Instagram, Reddit, and travel platforms',
      'Follows up instantly, answers questions 24/7, and books stays automatically',
      'Automatically requests 5-star reviews and manages your online reputation',
      'Monthly report showing travelers reached, bookings, and occupancy trend',
    ],
  },
  {
    key: 'social-media',
    name: 'Social Media Management',
    icon: 'share',
    monthly: 129700, // PROPOSED — combines the old Social Media Management ($997) + Content Creation ($297) = $1,294 raw sum, rounded up. Confirm/adjust this number.
    desc: [
      'Daily posts across Facebook and Instagram — photos, videos, and written content all created by AI',
      'Seasonal promotions, park updates, blog posts, and marketing copy',
      'AI handles replies and messages across Email, SMS, Instagram DM & Facebook DM',
      'Qualifies guests and books stays automatically',
    ],
  },
  {
    key: 'voice-ai',
    name: 'Voice AI Receptionist',
    icon: 'phone',
    setup: 100000,
    monthly: 45000,
    desc: [
      'Answers every call 24/7',
      'Books reservations automatically',
      'Never misses a call',
    ],
  },
];

export function formatUsd(cents, { decimals = 0 } = {}) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
