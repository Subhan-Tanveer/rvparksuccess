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
import { getPark, getParkWithMedia, getSitesForPark, getSite, getReservationsForPark, updateParkSettings, getParkStats, addPromoCode, removePromoCode, getWaitlistForPark, removeWaitlistEntry, getPayoutSummary, setParkStripeAccount, registerPark, getPropertiesForUser, addSite, updateSite, deleteSite, addSeasonalRate, removeSeasonalRate, createStaffReservation, updateReservationPaymentStatus } from '../_lib/reservations-store.js';
import { notifyWaitlistOfOpening } from '../_lib/waitlist-matcher.js';
import { syncReservationToGoogleCalendar, deleteReservationFromGoogleCalendar } from '../_lib/google-calendar.js';
import { sendGuestConfirmationEmail } from '../_lib/booking-emails.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  // resource: 'staff-booking' — lifted from the now-deleted
  // api/admin/staff-booking.js. This is what the front desk uses for a
  // phone or walk-in reservation.
  if (req.method === 'POST' && req.body?.resource === 'staff-booking') {
    const { siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, paymentMethod, notes } = req.body || {};
    try {
      const reservation = await createStaffReservation({
        parkId: session.parkId, siteId, checkIn, checkOut,
        guestName, guestEmail, guestPhone, paymentMethod, notes,
      });
      // Only sync once it's actually real (cash/card confirm immediately).
      // A pay-later hold is still just 'pending' — sync it once it's
      // marked paid via resource:'reservation-status' below, not now,
      // so a park's calendar doesn't fill up with holds nobody confirmed.
      if (reservation.status === 'confirmed' || reservation.status === 'confirmed-deposit') {
        const park = await getPark(session.parkId);
        if (park) {
          syncReservationToGoogleCalendar(park, reservation).catch((err) =>
            console.error('Google Calendar sync failed:', err.message)
          );
          // Guest still gets a confirmation email, but not an owner
          // notification — staff already know, they're the ones who just
          // entered this booking themselves.
          const site = await getSite(reservation.siteId).catch(() => null);
          sendGuestConfirmationEmail(park, reservation, site).catch((err) =>
            console.error('Guest confirmation email failed:', err.message)
          );
        }
      }
      return res.status(201).json({ reservation });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // resource: 'reservation-status' — lets staff correct a reservation's
  // payment status after the fact (e.g. a "pay later" hold that actually
  // got paid in cash, or a deposit balance that came in).
  if (req.method === 'POST' && req.body?.resource === 'reservation-status') {
    const { reservationId, status } = req.body || {};
    try {
      const reservation = await updateReservationPaymentStatus(session.parkId, reservationId, status);
      if (status === 'canceled') {
        notifyWaitlistOfOpening(session.parkId).catch((err) => console.error('Waitlist notify error:', err.message));
        deleteReservationFromGoogleCalendar(session.parkId, reservation).catch((err) =>
          console.error('Google Calendar delete failed:', err.message)
        );
      } else if (status === 'confirmed' || status === 'confirmed-deposit') {
        // Covers a pay-later hold getting marked paid — this is the first
        // time it becomes real enough to belong on the calendar and to
        // tell the guest it's confirmed. No owner notification here
        // either — staff are the ones making this exact status change.
        const park = await getPark(session.parkId);
        if (park) {
          syncReservationToGoogleCalendar(park, reservation).catch((err) =>
            console.error('Google Calendar sync failed:', err.message)
          );
          const site = await getSite(reservation.siteId).catch(() => null);
          sendGuestConfirmationEmail(park, reservation, site).catch((err) =>
            console.error('Guest confirmation email failed:', err.message)
          );
        }
      }
      return res.status(200).json({ reservation });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // resource: 'site' / 'season' — lifted from the now-deleted
  // api/admin/sites.js. The parkId always comes from the signed session,
  // never from the request body — a staff member can never edit another
  // park's sites, even if they tampered with the request.
  if (req.method === 'POST' && req.body?.resource === 'season') {
    const { siteId, label, startDate, endDate, nightlyRateCents } = req.body;
    try {
      const site = await addSeasonalRate(siteId, session.parkId, { label, startDate, endDate, nightlyRateCents });
      return res.status(201).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'season') {
    const { siteId, seasonId } = req.body;
    try {
      const site = await removeSeasonalRate(siteId, session.parkId, seasonId);
      return res.status(200).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && req.body?.resource === 'site') {
    const { name, type, capacity, nightlyRateCents } = req.body || {};
    try {
      const site = await addSite(session.parkId, { name, type, capacity, nightlyRateCents });
      return res.status(201).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'PUT' && req.body?.resource === 'site') {
    const { id, name, type, capacity, nightlyRateCents } = req.body || {};
    try {
      const site = await updateSite(id, session.parkId, { name, type, capacity, nightlyRateCents });
      return res.status(200).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'site') {
    const { id } = req.body || {};
    try {
      await deleteSite(id, session.parkId);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

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

  if (req.method === 'POST' && req.body?.resource === 'subscription') {
    const { action } = req.body;
    try {
      const park = await getPark(session.parkId);
      if (!park) return res.status(404).json({ error: 'Park not found' });
      if (!park.stripeSubscriptionId) return res.status(400).json({ error: 'No active subscription' });

      if (action === 'portal') {
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: park.stripeCustomerId,
          return_url: `${origin}/park-dashboard.html`,
        });
        return res.status(200).json({ url: portalSession.url });
      } else if (action === 'cancel') {
        await stripe.subscriptions.cancel(park.stripeSubscriptionId);
        return res.status(200).json({ ok: true, message: 'Subscription canceled' });
      } else {
        return res.status(400).json({ error: 'Unknown action' });
      }
    } catch (err) {
      console.error('Subscription management error:', err.message);
      return res.status(400).json({ error: err.message || 'Could not manage subscription' });
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

  const park = await getParkWithMedia(session.parkId);
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

  const [sites, reservations, stats, waitlist, payout, userProperties] = await Promise.all([
    getSitesForPark(session.parkId),
    getReservationsForPark(session.parkId),
    getParkStats(session.parkId),
    getWaitlistForPark(session.parkId),
    getPayoutSummary(session.parkId),
    getPropertiesForUser(session.parkId).catch(() => []), // Phase 4: Multi-property check
  ]);

  // Fetch subscription details if an active subscription exists
  let subscriptionDetails = null;
  if (park.stripeSubscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(park.stripeSubscriptionId);
      const paymentMethod = subscription.default_payment_method;
      let paymentMethodLast4 = null;
      if (typeof paymentMethod === 'string') {
        try {
          const pm = await stripe.paymentMethods.retrieve(paymentMethod);
          paymentMethodLast4 = pm.card?.last4 || null;
        } catch (err) {
          console.warn('Could not fetch payment method:', err.message);
        }
      }
      subscriptionDetails = {
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        paymentMethodLast4,
      };
    } catch (err) {
      console.error('Could not fetch subscription details:', err.message);
    }
  }

  res.status(200).json({ park: safePark, sites, reservations, stats, waitlist, payout, stripeStatus, subscriptionDetails, propertiesCount: userProperties.length });
}
