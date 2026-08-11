// Email automation rules engine
// Auto-sends pre-arrival, post-stay, abandoned booking recovery, and seasonal emails

import { getTemplate, TEMPLATE_TYPES } from './email-templates.js';
import {
  createEmailLog,
  isUnsubscribed,
  checkRateLimit,
  createEmailCampaign,
  incrementCampaignSend,
  getEmailStats,
} from './email-scheduler.js';
import { getPark, getReservationsForPark } from './reservations-store.js';
import { sendEmail } from './email-provider.js';

// Milliseconds for scheduling triggers
const TIME_BEFORE_CHECKIN_MS = 72 * 60 * 60 * 1000; // 72 hours
const TIME_AFTER_CHECKOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const TIME_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours after abandoned

/**
 * Check if a pre-arrival email should be sent
 * Sends 72 hours before check-in
 */
export function shouldSendPreArrival(reservation, park) {
  // Only for confirmed bookings
  if (!['confirmed', 'confirmed-deposit'].includes(reservation.status)) return false;

  // Only if park has pre-arrival enabled
  if (!park.emailPreArrival) return false;

  const checkInTime = new Date(reservation.checkIn);
  const now = new Date();
  const timeTilCheckIn = checkInTime - now;

  // Send if we're within 72-75 hours before check-in (75 to give a grace window)
  return timeTilCheckIn > TIME_BEFORE_CHECKIN_MS - 3 * 60 * 60 * 1000 && timeTilCheckIn <= TIME_BEFORE_CHECKIN_MS + 60 * 1000;
}

/**
 * Check if a post-stay email should be sent
 * Sends 24 hours after checkout
 */
export function shouldSendPostStay(reservation, park) {
  // Only for completed stays
  if (reservation.status !== 'confirmed' && !reservation.canceledAt) return false;

  // Only if park has post-stay enabled
  if (!park.emailPostStay) return false;

  const checkOutTime = new Date(reservation.checkOut);
  const now = new Date();
  const timeSinceCheckOut = now - checkOutTime;

  // Send if we're within 24-27 hours after checkout (27 to give a grace window)
  return timeSinceCheckOut >= TIME_AFTER_CHECKOUT_MS - 3 * 60 * 60 * 1000 && timeSinceCheckOut <= TIME_AFTER_CHECKOUT_MS + 60 * 1000;
}

/**
 * Check if recovery email should be sent
 * For abandoned bookings (started checkout but didn't confirm)
 */
export function shouldSendRecovery(reservation, park, checkoutSessionData) {
  // Only for pending/abandoned bookings
  if (reservation.status !== 'pending') return false;

  // Only if park has recovery enabled
  if (!park.emailRecovery) return false;

  // Only if hold is about to expire
  if (!reservation.holdExpiresAt) return false;

  const holdTime = new Date(reservation.holdExpiresAt);
  const now = new Date();
  const timeTilExpire = holdTime - now;

  // Send if hold expires in next 30-60 minutes
  return timeTilExpire > 30 * 60 * 1000 && timeTilExpire <= 60 * 60 * 1000;
}

/**
 * Send pre-arrival email to guest
 */
export async function sendPreArrivalEmail(reservation, park, siteInfo) {
  const isUnsub = await isUnsubscribed(reservation.guestEmail, park.id);
  if (isUnsub) return { sent: false, reason: 'unsubscribed' };

  const rateLimitOk = await checkRateLimit(reservation.guestEmail, park.id);
  if (!rateLimitOk) return { sent: false, reason: 'rate_limit' };

  const checkInDate = new Date(reservation.checkIn);
  const checkInDateStr = checkInDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const templateData = {
    guestName: reservation.guestName,
    checkInDate: checkInDateStr,
    checkInTime: park.checkInTime || '4:00 PM',
    siteNumber: siteInfo?.name || 'TBD',
    parkName: park.name,
    address: park.location,
    parkPhone: park.ownerPhone,
    parkEmail: park.senderEmail || 'info@rvparksuccess.com',
    wifiSsid: park.wifiSsid,
    wifiPassword: park.wifiPassword,
    parkingInstructions: park.parkingInstructions,
    siteRules: park.siteRules,
    emergencyPhone: park.emergencyPhone,
  };

  const html = getTemplate(TEMPLATE_TYPES.PRE_ARRIVAL, templateData);
  const subject = `Your Check-In Details for ${park.name} — ${checkInDateStr}`;

  try {
    const result = await sendEmail({
      to: reservation.guestEmail,
      subject,
      html,
      provider: park.emailProvider || 'nodemailer',
      from: park.senderEmail || 'bookings@rvparksuccess.com',
      fromName: park.senderName || 'RVPark Success',
    });

    await createEmailLog(park.id, {
      reservationId: reservation.id,
      guestEmail: reservation.guestEmail,
      guestName: reservation.guestName,
      templateType: TEMPLATE_TYPES.PRE_ARRIVAL,
      subject,
      provider: park.emailProvider || 'nodemailer',
      providerMessageId: result.messageId,
    });

    return { sent: true, messageId: result.messageId };
  } catch (err) {
    console.error('Failed to send pre-arrival email:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/**
 * Send post-stay email to guest
 * Includes review request and loyalty discount offer
 */
export async function sendPostStayEmail(reservation, park) {
  const isUnsub = await isUnsubscribed(reservation.guestEmail, park.id);
  if (isUnsub) return { sent: false, reason: 'unsubscribed' };

  const rateLimitOk = await checkRateLimit(reservation.guestEmail, park.id, 3);
  if (!rateLimitOk) return { sent: false, reason: 'rate_limit' };

  const checkOutDate = new Date(reservation.checkOut);
  const checkOutDateStr = checkOutDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Create review link (would include email + reservation ID for tracking)
  const reviewLink = `https://www.rvparksuccess.com/review/${park.id}/${reservation.id}/${Buffer.from(reservation.guestEmail).toString('base64')}`;

  const templateData = {
    guestName: reservation.guestName,
    checkOutDate: checkOutDateStr,
    parkName: park.name,
    loyaltyDiscountPercent: park.loyaltyDiscountPercent || 15,
    reviewLink,
  };

  const html = getTemplate(TEMPLATE_TYPES.POST_STAY, templateData);
  const subject = `Thanks for Your Stay at ${park.name}!`;

  try {
    const result = await sendEmail({
      to: reservation.guestEmail,
      subject,
      html,
      provider: park.emailProvider || 'nodemailer',
      from: park.senderEmail || 'bookings@rvparksuccess.com',
      fromName: park.senderName || 'RVPark Success',
    });

    await createEmailLog(park.id, {
      reservationId: reservation.id,
      guestEmail: reservation.guestEmail,
      guestName: reservation.guestName,
      templateType: TEMPLATE_TYPES.POST_STAY,
      subject,
      provider: park.emailProvider || 'nodemailer',
      providerMessageId: result.messageId,
    });

    return { sent: true, messageId: result.messageId };
  } catch (err) {
    console.error('Failed to send post-stay email:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/**
 * Send recovery email for abandoned bookings
 */
export async function sendRecoveryEmail(reservation, park) {
  const isUnsub = await isUnsubscribed(reservation.guestEmail, park.id);
  if (isUnsub) return { sent: false, reason: 'unsubscribed' };

  const rateLimitOk = await checkRateLimit(reservation.guestEmail, park.id);
  if (!rateLimitOk) return { sent: false, reason: 'rate_limit' };

  const checkInDate = new Date(reservation.checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const checkOutDate = new Date(reservation.checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Create checkout completion link
  const checkoutLink = `https://www.rvparksuccess.com/checkout/${reservation.stripeSessionId || reservation.id}?recovery=1`;

  const templateData = {
    guestName: reservation.guestName,
    parkName: park.name,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    siteNumber: reservation.siteId,
    totalPrice: `$${(reservation.totalCents / 100).toFixed(2)}`,
    discountPercent: 10,
    expiryHours: 24,
    checkoutLink,
  };

  const html = getTemplate(TEMPLATE_TYPES.RECOVERY, templateData);
  const subject = `Complete Your Booking at ${park.name} — 10% Off Inside`;

  try {
    const result = await sendEmail({
      to: reservation.guestEmail,
      subject,
      html,
      provider: park.emailProvider || 'nodemailer',
      from: park.senderEmail || 'bookings@rvparksuccess.com',
      fromName: park.senderName || 'RVPark Success',
    });

    await createEmailLog(park.id, {
      reservationId: reservation.id,
      guestEmail: reservation.guestEmail,
      guestName: reservation.guestName,
      templateType: TEMPLATE_TYPES.RECOVERY,
      subject,
      provider: park.emailProvider || 'nodemailer',
      providerMessageId: result.messageId,
    });

    return { sent: true, messageId: result.messageId };
  } catch (err) {
    console.error('Failed to send recovery email:', err.message);
    return { sent: false, reason: 'send_error', error: err.message };
  }
}

/**
 * Send seasonal promotion email
 * Called manually or on a schedule (every 30 days)
 */
export async function sendSeasonalPromoEmail(parkId, promoData) {
  const park = await getPark(parkId);
  if (!park) throw new Error('Park not found');

  if (!park.emailPromo) return { sent: false, reason: 'promo_disabled' };

  const reservations = await getReservationsForPark(parkId);
  const guests = [...new Set(reservations.map((r) => ({ name: r.guestName, email: r.guestEmail })))];

  const results = { sent: 0, failed: 0, unsubscribed: 0, skipped: 0 };
  const campaignId = await createEmailCampaign(parkId, {
    campaignType: 'seasonal-promo',
    templateType: TEMPLATE_TYPES.SEASONAL_PROMO,
    name: promoData.title,
  });

  for (const guest of guests) {
    const isUnsub = await isUnsubscribed(guest.email, parkId);
    if (isUnsub) {
      results.unsubscribed++;
      continue;
    }

    const templateData = {
      guestName: guest.name,
      parkName: park.name,
      promoTitle: promoData.title,
      promoDescription: promoData.description,
      offerDetails: promoData.details,
      offerCode: promoData.code,
      bookingLink: `https://www.rvparksuccess.com/book/${parkId}?promo=${promoData.code}`,
      endDate: promoData.endDate,
    };

    const html = getTemplate(TEMPLATE_TYPES.SEASONAL_PROMO, templateData);
    const subject = `${promoData.title} at ${park.name}`;

    try {
      const result = await sendEmail({
        to: guest.email,
        subject,
        html,
        provider: park.emailProvider || 'nodemailer',
        from: park.senderEmail || 'bookings@rvparksuccess.com',
        fromName: park.senderName || 'RVPark Success',
      });

      await createEmailLog(parkId, {
        guestEmail: guest.email,
        guestName: guest.name,
        templateType: TEMPLATE_TYPES.SEASONAL_PROMO,
        subject,
        provider: park.emailProvider || 'nodemailer',
        providerMessageId: result.messageId,
      });

      await incrementCampaignSend(campaignId);
      results.sent++;
    } catch (err) {
      console.error(`Failed to send promo email to ${guest.email}:`, err.message);
      results.failed++;
    }
  }

  return { campaignId, results };
}

/**
 * Check all reservations for parks and send automatable emails
 * This should run periodically (every 5 minutes, via Vercel cron or similar)
 */
export async function processAutomatedEmails(parkIds = []) {
  const results = { processed: 0, sent: 0, failed: 0 };

  // Get parks to process (if not specified, all parks with emails enabled)
  const parks = parkIds.length > 0
    ? (await Promise.all(parkIds.map(getPark))).filter(Boolean)
    : await query('SELECT * FROM parks WHERE emails_enabled = true');

  for (const park of parks) {
    if (!park.emailsEnabled) continue;

    const reservations = await getReservationsForPark(park.id);

    for (const res of reservations) {
      results.processed++;

      // Check for pre-arrival
      if (shouldSendPreArrival(res, park)) {
        const result = await sendPreArrivalEmail(res, park, null);
        if (result.sent) results.sent++;
        else results.failed++;
      }

      // Check for post-stay
      if (shouldSendPostStay(res, park)) {
        const result = await sendPostStayEmail(res, park);
        if (result.sent) results.sent++;
        else results.failed++;
      }

      // Check for recovery
      if (shouldSendRecovery(res, park)) {
        const result = await sendRecoveryEmail(res, park);
        if (result.sent) results.sent++;
        else results.failed++;
      }
    }
  }

  return results;
}

export { TEMPLATE_TYPES };
