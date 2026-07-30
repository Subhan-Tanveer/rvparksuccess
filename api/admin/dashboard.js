// GET /api/admin/dashboard — park-staff only. Everything the staff
// dashboard needs on load, in one call: this park's info, its sites, and
// its recent reservations (both guest self-service and staff-entered).
// POST — update this park's own settings (tax rate, deposit %), or (with
// resource: 'stripe-connect') start/continue Stripe Connect onboarding so
// the park gets paid out automatically. Combined into this one route
// rather than new files to stay under Vercel's Hobby-plan 12-function
// limit.
import Stripe from 'stripe';
import { requireSession } from '../_lib/auth.js';
import { getPark, getSitesForPark, getReservationsForPark, updateParkSettings, getParkStats, addPromoCode, removePromoCode, getWaitlistForPark, removeWaitlistEntry, getPayoutSummary, setParkStripeAccount, registerPark } from '../_lib/reservations-store.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method === 'POST' && req.body?.resource === 'stripe-connect') {
    try {
      const park = await getPark(session.parkId);
      if (!park) return res.status(404).json({ error: 'Park not found' });

      // Reuse the existing connected account if onboarding was already
      // started but not finished — Stripe account links can be regenerated
      // any number of times for the same account, so there's no need (or
      // way) to create a second account for the same park.
      let accountId = park.stripeAccountId;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'US',
          email: park.ownerEmail || undefined,
          business_type: 'individual',
          business_profile: { name: park.name, product_description: 'RV park / campground reservations' },
        });
        accountId = account.id;
        await setParkStripeAccount(session.parkId, accountId);
      }

      const origin = req.headers.origin || `https://${req.headers.host}`;
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${origin}/park-dashboard.html?stripe=refresh`,
        return_url: `${origin}/park-dashboard.html?stripe=return`,
        type: 'account_onboarding',
      });

      return res.status(200).json({ url: accountLink.url });
    } catch (err) {
      console.error('Stripe Connect onboarding error:', err.message);
      // Most likely cause in a fresh Stripe account: Connect isn't enabled
      // yet on the platform (Stripe Dashboard → Connect → Get started).
      // Surface Stripe's own message since it tells the owner exactly what
      // to do, rather than a generic failure.
      return res.status(400).json({ error: err.message || 'Could not start Stripe onboarding' });
    }
  }

  if (req.method === 'POST' && req.body?.resource === 'register-park') {
    const { parkName, location } = req.body;
    try {
      const park = await registerPark(session.parkId, { parkName, location });
      const { passwordHash, ...safePark } = park;
      return res.status(200).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && req.body?.resource === 'promo') {
    const { code, type, value } = req.body;
    try {
      const park = await addPromoCode(session.parkId, { code, type, value });
      const { passwordHash, ...safePark } = park;
      return res.status(201).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'promo') {
    try {
      const park = await removePromoCode(session.parkId, req.body.promoId);
      const { passwordHash, ...safePark } = park;
      return res.status(200).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'waitlist') {
    try {
      await removeWaitlistEntry(req.body.entryId, session.parkId);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const park = await updateParkSettings(session.parkId, req.body || {});
      const { passwordHash, ...safePark } = park;
      return res.status(200).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const park = await getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });
  const { passwordHash, ...safePark } = park;

  // If onboarding was started, check with Stripe whether it's actually
  // finished (payouts_enabled) rather than trusting a stale local flag —
  // an owner can leave onboarding half-done, and Stripe is the only source
  // of truth for that. Failing this check shouldn't break the whole
  // dashboard load, so it's caught locally rather than propagating.
  let stripeStatus = { connected: false, payoutsEnabled: false };
  if (park.stripeAccountId) {
    try {
      const account = await stripe.accounts.retrieve(park.stripeAccountId);
      stripeStatus = { connected: true, payoutsEnabled: !!account.payouts_enabled, detailsSubmitted: !!account.details_submitted };
    } catch (err) {
      console.error('Stripe account status check failed:', err.message);
      stripeStatus = { connected: true, payoutsEnabled: false, error: true };
    }
  }

  const [sites, reservations, stats, waitlist, payout] = await Promise.all([
    getSitesForPark(session.parkId),
    getReservationsForPark(session.parkId),
    getParkStats(session.parkId),
    getWaitlistForPark(session.parkId),
    getPayoutSummary(session.parkId),
  ]);

  res.status(200).json({ park: safePark, sites, reservations, stats, waitlist, payout, stripeStatus });
}
