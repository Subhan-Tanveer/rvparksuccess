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

  const park = getPark(parkId);
  const site = getSite(siteId);
  if (!park || !site || site.parkId !== parkId) {
    return res.status(404).json({ error: 'Unknown park or site' });
  }

  let reservation;
  try {
    reservation = createPendingReservation({ parkId, siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, promoCode });
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
  const lineItems = [
    {
      price_data: {
        currency: 'usd',
        product_data: { name: `${park.name} — ${site.name} (${reservation.nights} night${reservation.nights === 1 ? '' : 's'}, ${checkIn} to ${checkOut})${isDeposit ? ' — Deposit' : ''}` },
        unit_amount: Math.round(reservation.subtotalCents * chargeRatio) - Math.round(reservation.discountCents * chargeRatio),
      },
      quantity: 1,
    },
  ];
  if (reservation.taxCents > 0) {
    lineItems.push({
      price_data: { currency: 'usd', product_data: { name: `Lodging Tax (${reservation.taxRatePercent}%)` }, unit_amount: Math.round(reservation.taxCents * chargeRatio) },
      quantity: 1,
    });
  }
  lineItems.push({
    price_data: { currency: 'usd', product_data: { name: 'Booking Fee' }, unit_amount: Math.round(reservation.feeCents * chargeRatio) },
    quantity: 1,
  });

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: guestEmail,
      line_items: lineItems,
      metadata: { reservationId: reservation.id, parkId, siteId },
      success_url: `${origin}/reservations.html?park=${parkId}&checkout=success`,
      cancel_url: `${origin}/reservations.html?park=${parkId}&checkout=canceled`,
    });

    attachStripeSession(reservation.id, session.id);
    res.status(200).json({ url: session.url, reservationId: reservation.id });
  } catch (err) {
    console.error('Reservation checkout session error:', err.message);
    res.status(500).json({ error: 'Unable to start checkout. Please try again shortly.' });
  }
}
