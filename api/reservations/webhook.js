// Vercel serverless function — POST /api/reservations/webhook
// Stripe calls this once a reservation checkout actually completes payment.
// This is what flips a reservation from "pending" (held, unpaid) to
// "confirmed" — the booking page itself never marks a reservation paid on
// its own, precisely so a guest closing the tab mid-checkout can't fake a
// confirmed booking.
//
// Requires STRIPE_WEBHOOK_SECRET, set in the Vercel dashboard (Project →
// Settings → Environment Variables) once you've created this webhook
// endpoint in the Stripe Dashboard (Developers → Webhooks → Add endpoint,
// pointed at https://yourdomain.com/api/reservations/webhook, listening
// for the checkout.session.completed event). Never put this value in any
// file in this repo.
import Stripe from 'stripe';
import { confirmReservationBySessionId } from '../_lib/reservations-store.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Reservation webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const confirmed = await confirmReservationBySessionId(session.id);
    if (!confirmed) console.warn('Webhook confirmed a session with no matching reservation:', session.id);
  }

  res.status(200).json({ received: true });
}
