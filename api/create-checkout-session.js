// Vercel serverless function — creates a Stripe Checkout Session server-side.
//
// Requires STRIPE_SECRET_KEY to be set as an environment variable in the
// Vercel project dashboard (Project → Settings → Environment Variables).
// NEVER commit the secret key or put it in any file in this repo — Stripe
// SDK reads it from process.env at request time only.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Prices in cents. Keep in sync with src/js/services-data.js (PACKAGES).
// All three levels are monthly subscriptions — no one-time setup fees.
const SERVICES = {
  foundation: { name: 'RVPark Success — Level 1: Foundation', setup: 0, monthly: 69500 },
  growth: { name: 'RVPark Success — Level 2: Growth', setup: 0, monthly: 129500 },
  maximum: { name: 'RVPark Success — Level 3: Maximum', setup: 0, monthly: 199500 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const svcKey = req.body?.service;
  const svc = SERVICES[svcKey];
  if (!svc) return res.status(400).json({ error: 'Unknown service' });

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const lineItems = [];

    if (svc.monthly) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: svc.name },
          unit_amount: svc.monthly,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      });
    }
    if (svc.setup) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: svc.monthly ? `${svc.name} — One-Time Setup` : svc.name },
          unit_amount: svc.setup,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: svc.monthly ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${origin}/packages.html?checkout=success`,
      cancel_url: `${origin}/packages.html?checkout=canceled`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err.message);
    res.status(500).json({ error: 'Unable to start checkout. Please try again shortly.' });
  }
}
