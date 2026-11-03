// Guest account API — signup, login, logout, and dashboard data, all in one
// serverless function (same pattern as api/admin/auth.js) to stay under
// Vercel's Hobby-plan limit of 12 serverless functions per deployment.
//
// POST { action: 'signup' | 'login' | 'logout', ... }
// GET  → the logged-in guest's profile + booking history across all parks
import Stripe from 'stripe';
import { createGuestSessionCookie, clearGuestSessionCookie, getGuestSession } from './_lib/auth.js';
import { createGuestAccount, verifyGuestLogin, getGuestByEmail, getBookingsForGuest, getReservationForGuestCancellation, finalizeGuestCancellation, getBookingRules } from './_lib/reservations-store.js';
import { notifyWaitlistOfOpening } from './_lib/waitlist-matcher.js';
import { deleteReservationFromGoogleCalendar } from './_lib/google-calendar.js';
import { enforceCancellationPolicy } from './_lib/booking-rules-engine.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const cancellationRuleStore = { getBookingRules };

// Best-effort Stripe refund for a guest cancellation — computes the
// refund via the park's configured cancellation policy (full refund if
// none is set), then actually issues it through Stripe. Returns what
// happened so it can be stored on the reservation and shown to the
// guest; never throws — a Stripe hiccup must not block the cancellation
// itself from going through (same "side effects never block the primary
// action" rule as the rest of this codebase), it just means staff will
// need to follow up manually.
async function processCancellationRefund(reservation) {
  const wasPaid = (reservation.status === 'confirmed' || reservation.status === 'confirmed-deposit') && reservation.stripeSessionId;
  if (!wasPaid) {
    return { refundCents: null, refundReason: 'Not paid — nothing to refund', stripeRefundId: null };
  }

  const policyResult = await enforceCancellationPolicy(reservation, new Date(), cancellationRuleStore);
  if (!policyResult.refund_cents) {
    return { refundCents: 0, refundReason: policyResult.reason, stripeRefundId: null };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(reservation.stripeSessionId, { expand: ['payment_intent'] });
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntentId) {
      return { refundCents: 0, refundReason: 'No payment found to refund — contact the park directly', stripeRefundId: null };
    }

    // A Connect destination charge needs the transfer reversed and the
    // platform's application fee refunded too, or the connected account
    // keeps the money while the platform eats the refund — see
    // create-checkout.js's Connect handling for the charge-side of this.
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: policyResult.refund_cents,
      ...(reservation.paidViaConnect ? { reverse_transfer: true, refund_application_fee: true } : {}),
    });

    return { refundCents: policyResult.refund_cents, refundReason: policyResult.reason, stripeRefundId: refund.id };
  } catch (err) {
    console.error('Cancellation refund failed (non-fatal — cancellation still proceeds):', err.message);
    return { refundCents: 0, refundReason: `Refund failed automatically (${err.message}) — contact the park directly`, stripeRefundId: null };
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getGuestSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    const guest = await getGuestByEmail(session.guestEmail);
    if (!guest) return res.status(401).json({ error: 'Not signed in' });

    return res.status(200).json({
      guest: { name: guest.name, email: guest.email, phone: guest.phone },
      bookings: await getBookingsForGuest(guest.email),
    });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'signup') {
      const { name, email, password, phone } = req.body;
      try {
        const guest = await createGuestAccount({ name, email, password, phone });
        res.setHeader('Set-Cookie', createGuestSessionCookie({ guestEmail: guest.email }));
        return res.status(200).json({ ok: true, name: guest.name });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (action === 'login') {
      const { email, password } = req.body;
      const guest = await verifyGuestLogin(email, password);
      if (!guest) return res.status(401).json({ error: 'Incorrect email or password' });

      res.setHeader('Set-Cookie', createGuestSessionCookie({ guestEmail: guest.email }));
      return res.status(200).json({ ok: true, name: guest.name });
    }

    if (action === 'cancel') {
      const session = getGuestSession(req);
      if (!session) return res.status(401).json({ error: 'Not signed in' });
      const { reservationId } = req.body;
      try {
        const beforeCancel = await getReservationForGuestCancellation(reservationId, session.guestEmail);
        const refundOutcome = await processCancellationRefund(beforeCancel);
        const reservation = await finalizeGuestCancellation(reservationId, refundOutcome);
        notifyWaitlistOfOpening(reservation.parkId).catch((err) => console.error('Waitlist notify error:', err.message));
        deleteReservationFromGoogleCalendar(reservation.parkId, reservation).catch((err) =>
          console.error('Google Calendar delete failed:', err.message)
        );
        return res.status(200).json({ ok: true, reservation });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', clearGuestSessionCookie());
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
