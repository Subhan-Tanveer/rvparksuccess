// Vercel serverless function — POST /api/reservations/webhook
// The one Stripe webhook endpoint for the whole platform (kept singular to
// stay under Vercel's Hobby-plan 12-function limit) — it branches on
// checkout.session.completed's `mode` to handle two unrelated flows:
//   - 'payment': a guest's reservation checkout. Flips a reservation from
//     "pending" (held, unpaid) to "confirmed" — the booking page itself
//     never marks a reservation paid on its own, precisely so a guest
//     closing the tab mid-checkout can't fake a confirmed booking.
//   - 'subscription': an RVPark owner's plan checkout (see
//     api/create-checkout-session.js). Records which plan they're now on
//     against their park, using the parkId passed as client_reference_id
//     at checkout-creation time.
//
// Requires STRIPE_WEBHOOK_SECRET, set in the Vercel dashboard (Project →
// Settings → Environment Variables) once you've created this webhook
// endpoint in the Stripe Dashboard (Developers → Webhooks → Add endpoint,
// pointed at https://yourdomain.com/api/reservations/webhook, listening
// for the checkout.session.completed event). Never put this value in any
// file in this repo.
import Stripe from 'stripe';
import { confirmReservationBySessionId, setParkPlan, getPark } from '../_lib/reservations-store.js';
import { syncReservationToGoogleCalendar } from '../_lib/google-calendar.js';

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

    if (session.mode === 'subscription') {
      if (!session.client_reference_id) {
        console.warn('Subscription checkout completed with no client_reference_id — cannot attribute a plan to any park:', session.id);
      } else {
        await setParkPlan(session.client_reference_id, {
          planKey: session.metadata?.service || null,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
        });
      }
    } else {
      const confirmed = await confirmReservationBySessionId(session.id);
      if (!confirmed) {
        console.warn('Webhook confirmed a session with no matching reservation:', session.id);
      } else {
        // Best-effort — a park with no Google Calendar connected returns
        // immediately (see syncReservationToGoogleCalendar), and a real
        // sync failure must never fail the webhook itself: Stripe retries
        // a non-2xx response, which would re-run the whole confirmation
        // path (already idempotent, but pointless) just because Google
        // hiccuped.
        const park = await getPark(confirmed.parkId);
        if (park) {
          syncReservationToGoogleCalendar(park, confirmed).catch((err) =>
            console.error('Google Calendar sync failed:', err.message)
          );
        }
      }
    }
  }

  res.status(200).json({ received: true });
}
