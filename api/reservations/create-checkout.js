// Vercel serverless function — POST /api/reservations/create-checkout
// Holds the requested site for a short window, then creates a Stripe
// Checkout Session for the stay (nights x rate + platform booking fee).
// Requires STRIPE_SECRET_KEY — see api/create-checkout-session.js for the
// same secret-key handling notes; nothing sensitive lives in this repo.
import Stripe from 'stripe';
import { createPendingReservation, attachStripeSession, getPark, getSite } from '../_lib/reservations-store.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, promoCode } = req.body || {};
  if (!parkId || !siteId || !checkIn || !checkOut || !guestName || !guestEmail) {
    return res.status(400).json({ error: 'Missing required booking details' });
  }

  const [park, site] = await Promise.all([getPark(parkId), getSite(siteId)]);
  if (!park || !site || site.parkId !== parkId) {
    return res.status(404).json({ error: 'Unknown park or site' });
  }

  let reservation;
  try {
    reservation = await createPendingReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, promoCode });
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }

  // Charging the deposit only (when the park has one configured) still
  // holds the full site — the balance is collected later, in person or via
  // a follow-up link. depositCents falls back to totalCents when there's
  // no deposit configured, so this is a no-op for parks without one.
  const isDeposit = reservation.depositCents < reservation.totalCents;
  const chargeCents = reservation.depositCents;
  // Stripe's line items don't need to sum to a specific figure, but we
  // still want the receipt to show real numbers — scale each component
  // proportionally to what's actually being charged today.
  const chargeRatio = reservation.totalCents > 0 ? chargeCents / reservation.totalCents : 1;

  const ratePortionCents = Math.round(reservation.subtotalCents * chargeRatio) - Math.round(reservation.discountCents * chargeRatio);
  const taxPortionCents = reservation.taxCents > 0 ? Math.round(reservation.taxCents * chargeRatio) : 0;
  // The booking fee line absorbs whatever's left rather than being rounded
  // independently — rounding each portion separately can land a cent or two
  // off the promised total (e.g. $4.05 + $0.41 + $0.08 = $4.54 when the
  // guest was told $4.53), since rounded pieces don't always sum back to
  // the original rounded total. This guarantees the three line items
  // always add up to exactly what reservations.js showed the guest.
  const feePortionCents = chargeCents - ratePortionCents - taxPortionCents;

  const lineItems = [
    {
      price_data: {
        currency: 'usd',
        product_data: { name: `${park.name} — ${site.name} (${reservation.nights} night${reservation.nights === 1 ? '' : 's'}, ${checkIn} to ${checkOut})${isDeposit ? ' — Deposit' : ''}` },
        unit_amount: ratePortionCents,
      },
      quantity: 1,
    },
  ];
  if (taxPortionCents > 0) {
    lineItems.push({
      price_data: { currency: 'usd', product_data: { name: `Lodging Tax (${reservation.taxRatePercent}%)` }, unit_amount: taxPortionCents },
      quantity: 1,
    });
  }
  lineItems.push({
    price_data: { currency: 'usd', product_data: { name: 'Booking Fee' }, unit_amount: feePortionCents },
    quantity: 1,
  });

  // If the park has finished Stripe Connect onboarding, route this charge
  // as a destination charge: the full amount hits the platform account,
  // Stripe automatically transfers everything except the platform's
  // booking-fee cut to the park's own connected account. No separate
  // transfer call needed — it happens atomically with the charge. Parks
  // that haven't connected (or haven't finished onboarding) fall back to
  // the platform-only charge, same as before Connect existed — their
  // payout still shows correctly in the dashboard, just paid out manually.
  let paymentIntentData;
  if (park.stripeAccountId) {
    try {
      const account = await stripe.accounts.retrieve(park.stripeAccountId);
      if (account.payouts_enabled) {
        // Same figure as the "Booking Fee" line item above, not an
        // independently-rounded recalculation — keeps what the platform
        // takes in sync with what the guest was actually shown.
        paymentIntentData = {
          application_fee_amount: feePortionCents,
          transfer_data: { destination: park.stripeAccountId },
        };
      }
    } catch (err) {
      console.error('Stripe Connect account check failed, falling back to platform-only charge:', err.message);
    }
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: guestEmail,
      line_items: lineItems,
      ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
      metadata: { reservationId: reservation.id, parkId, siteId },
      success_url: `${origin}/reservations.html?park=${parkId}&checkout=success`,
      cancel_url: `${origin}/reservations.html?park=${parkId}&checkout=canceled`,
    });

    await attachStripeSession(reservation.id, session.id, !!paymentIntentData);
    res.status(200).json({ url: session.url, reservationId: reservation.id });
  } catch (err) {
    console.error('Reservation checkout session error:', err.message);
    res.status(500).json({ error: 'Unable to start checkout. Please try again shortly.' });
  }
}
