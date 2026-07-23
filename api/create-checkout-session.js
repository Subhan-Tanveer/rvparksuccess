// Vercel serverless function — creates a Stripe Checkout Session server-side.
//
// Requires STRIPE_SECRET_KEY to be set as an environment variable in the
// Vercel project dashboard (Project → Settings → Environment Variables).
// NEVER commit the secret key or put it in any file in this repo — Stripe
// SDK reads it from process.env at request time only.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Prices in cents. Keep in sync with src/js/services-data.js.
// setup: one-time fee (billed once at checkout). monthly: recurring fee.
// A service with both gets a single subscription session with a one-time
// line item alongside the recurring one (Stripe supports mixing the two
// in subscription mode). A service with only `setup` is a one-time payment.
const SERVICES = {
  'website-design': { name: 'RVPark Success — Website Design', setup: 185000, monthly: 0 },
  'social-media': { name: 'RVPark Success — Social Media Management', setup: 0, monthly: 49700 },
  'ai-guest-finder': { name: 'RVPark Success — AI Guest Finder', setup: 0, monthly: 99700 },
  'ai-booking': { name: 'RVPark Success — AI Booking System', setup: 0, monthly: 29700 },
  'ai-content': { name: 'RVPark Success — AI Content Creation', setup: 0, monthly: 47000 },
  'review-reputation': { name: 'RVPark Success — Review and Reputation Marketing', setup: 0, monthly: 19700 },
  'financial-records': { name: 'RVPark Success — Financial Records & Revenue Tracking', setup: 0, monthly: 14700 },
  'monthly-reporting': { name: 'RVPark Success — Monthly Reporting', setup: 0, monthly: 9700 },
  'voice-ai': { name: 'RVPark Success — Voice AI Receptionist', setup: 100000, monthly: 45000 },
  'conversational-ai': { name: 'RVPark Success — Conversational AI (Email, SMS & DMs)', setup: 70000, monthly: 30000 },
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
    res.status(500).json({ error: 'Unable to start checkout. Please try again or use PayPal/Zelle.' });
  }
}
