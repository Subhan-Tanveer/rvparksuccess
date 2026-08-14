// Vercel serverless function — creates a Stripe Checkout Session server-side.
//
// Requires STRIPE_SECRET_KEY to be set as an environment variable in the
// Vercel project dashboard (Project → Settings → Environment Variables).
// NEVER commit the secret key or put it in any file in this repo — Stripe
// SDK reads it from process.env at request time only.
import Stripe from 'stripe';
import { requireSession } from './_lib/auth.js';

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set in environment variables');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Prices in cents. Keep in sync with src/js/services-data.js (PACKAGES).
// All are monthly subscriptions — no one-time setup fees.
const SERVICES = {
  foundation: { name: 'RVPark Success — Level 1: Foundation', setup: 0, monthly: 69500 },
  growth: { name: 'RVPark Success — Level 2: Growth', setup: 0, monthly: 129500 },
  maximum: { name: 'RVPark Success — Level 3: Maximum', setup: 0, monthly: 199500 },
  'website-booking': { name: 'RVPark Success — Website & Booking System', setup: 0, monthly: 30000 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Picking a plan requires an owner account to exist first (sign up ->
  // pick a plan -> pay -> register the park) — this is what enforces that
  // order. A logged-out visitor gets a 401 here; packages.js sends them to
  // login.html when that happens.
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

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

    const successUrl = `${origin}/register-park.html?checkout=success`;
    const cancelUrl = `${origin}/packages.html?checkout=canceled`;
    console.log('Creating Stripe session:', { successUrl, cancelUrl, parkId: session.parkId, service: svcKey });

    // client_reference_id + metadata are how the webhook (see
    // api/reservations/webhook.js's 'subscription' mode branch) knows
    // which park to record this plan against once payment completes.
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: svc.monthly ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      client_reference_id: session.parkId,
      metadata: { type: 'subscription', service: svcKey },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    console.log('Stripe session created:', { sessionId: checkoutSession.id, url: checkoutSession.url });
    res.status(200).json({ url: checkoutSession.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err.message);
    res.status(500).json({ error: 'Unable to start checkout. Please try again shortly.' });
  }
}
