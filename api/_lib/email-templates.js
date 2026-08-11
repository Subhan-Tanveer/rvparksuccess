// Email template library for RV park marketing automation.
// Supports pre-arrival, post-stay, abandoned booking recovery, and seasonal promotions.
// Variables use {{templateVar}} syntax and are interpolated at send time.

import { renderEmail } from './email-template.js';

const TEMPLATE_TYPES = {
  PRE_ARRIVAL: 'pre-arrival',
  POST_STAY: 'post-stay',
  RECOVERY: 'recovery',
  SEASONAL_PROMO: 'seasonal-promo',
};

/**
 * Pre-arrival email — sent 72 hours before check-in
 * Includes check-in details, parking instructions, WiFi, site rules, emergency contact
 */
export function getPreArrivalTemplate(data = {}) {
  const { guestName, checkInDate, checkInTime = '4:00 PM', siteNumber, parkName, address, parkPhone, parkEmail, wifiSsid, wifiPassword, parkingInstructions, siteRules, emergencyPhone } = data;

  const details = [
    ['Check-in Date', checkInDate],
    ['Check-in Time', checkInTime],
    ['Site Number', siteNumber],
    ['Park Location', address],
    ['Park Phone', parkPhone],
  ];

  if (wifiSsid) {
    details.push(['WiFi Network', wifiSsid]);
    if (wifiPassword) details.push(['WiFi Password', wifiPassword]);
  }

  if (emergencyPhone) {
    details.push(['Emergency Contact', emergencyPhone]);
  }

  const closingParts = [];
  if (parkingInstructions) closingParts.push(`Parking: ${parkingInstructions}`);
  if (siteRules) closingParts.push(`Site Rules: ${siteRules}`);
  const closing = closingParts.length ? closingParts.join('\n\n') : null;

  return renderEmail({
    eyebrow: 'Get Ready for Your Stay',
    title: `Welcome to ${parkName}, ${guestName}!`,
    intro: `Your reservation is confirmed for ${checkInDate}. Here's everything you need to know for check-in and your stay.`,
    details,
    cta: { label: 'View Reservation Details', href: 'https://www.rvparksuccess.com/guest-portal' },
    closing,
  });
}

/**
 * Post-stay follow-up — sent 24 hours after checkout
 * Thank you message, review request, loyalty discount offer, recommendations
 */
export function getPostStayTemplate(data = {}) {
  const { guestName, checkOutDate, parkName, loyaltyDiscountPercent = 15, reviewLink, recommendationsHtml } = data;

  const details = [
    ['Stay Ended', checkOutDate],
    ['Loyalty Discount', `${loyaltyDiscountPercent}% off your next booking`],
  ];

  const closingParts = [
    `Thank you for choosing ${parkName}! We'd love to hear about your experience.`,
  ];

  if (reviewLink) {
    closingParts.push(`Your feedback helps us improve. Visit our review page to share your thoughts!`);
  }

  if (recommendationsHtml) {
    closingParts.push(`\n\nGuests who stayed at ${parkName} also loved these nearby parks.`);
  }

  return renderEmail({
    eyebrow: 'Thanks for Your Stay',
    title: 'We Hope You Enjoyed Your Time With Us!',
    intro: `${guestName}, thank you for choosing ${parkName}. Your stay ended on ${checkOutDate}.`,
    details,
    cta: reviewLink ? { label: 'Share Your Review', href: reviewLink } : null,
    closing: closingParts.join('\n\n'),
  });
}

/**
 * Abandoned booking recovery — sent if checkout was started but not completed
 * "You left something in your cart" + time-limited incentive
 */
export function getRecoveryTemplate(data = {}) {
  const { guestName, parkName, checkIn, checkOut, siteNumber, totalPrice, discountPercent = 10, expiryHours = 24, checkoutLink } = data;

  const details = [
    ['Park', parkName],
    ['Dates', `${checkIn} to ${checkOut}`],
    ['Site', siteNumber || 'TBD'],
    ['Original Total', totalPrice],
    ['With Offer', `${discountPercent}% off`],
  ];

  const closing = `Complete your booking in the next ${expiryHours} hours to lock in this ${discountPercent}% discount. No guarantees after that!`;

  return renderEmail({
    eyebrow: 'Finish Your Booking',
    title: `${guestName}, Your Reservation is Waiting!`,
    intro: `You started a booking at ${parkName} but didn't finish. We've saved ${discountPercent}% off — but only for the next ${expiryHours} hours.`,
    details,
    cta: checkoutLink ? { label: 'Complete Booking Now', href: checkoutLink } : null,
    closing,
  });
}

/**
 * Seasonal promotion — configurable by park owner
 * Off-season rates, weekend specials, loyalty program updates
 */
export function getSeasonalPromoTemplate(data = {}) {
  const { guestName, parkName, promoTitle, promoDescription, offerDetails, offerCode, bookingLink, endDate } = data;

  const details = [
    ['Offer', offerCode || 'No code needed'],
    ['Valid Until', endDate || 'See terms'],
  ];

  return renderEmail({
    eyebrow: 'Limited-Time Offer',
    title: promoTitle || `Special Offer at ${parkName}`,
    intro: guestName ? `${guestName}, ` : '' + (promoDescription || `We have an exclusive offer just for you!`),
    details,
    cta: bookingLink ? { label: 'Book Your Stay', href: bookingLink } : null,
    closing: offerDetails || null,
  });
}

/**
 * Generic template for custom emails
 * Park owners can create their own messages with these fields
 */
export function getCustomTemplate(data = {}) {
  const { title, intro, details = [], cta, closing, eyebrow = 'Message' } = data;
  return renderEmail({ eyebrow, title, intro, details, cta, closing });
}

/**
 * Compile template with actual guest data
 * Replaces all {{variable}} placeholders with actual values
 */
export function compileTemplate(templateHtml, variables = {}) {
  let compiled = templateHtml;
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    compiled = compiled.replace(placeholder, String(value || ''));
  });
  return compiled;
}

/**
 * Get template by type and compile with data
 */
export function getTemplate(templateType, data = {}) {
  let html;
  switch (templateType) {
    case TEMPLATE_TYPES.PRE_ARRIVAL:
      html = getPreArrivalTemplate(data);
      break;
    case TEMPLATE_TYPES.POST_STAY:
      html = getPostStayTemplate(data);
      break;
    case TEMPLATE_TYPES.RECOVERY:
      html = getRecoveryTemplate(data);
      break;
    case TEMPLATE_TYPES.SEASONAL_PROMO:
      html = getSeasonalPromoTemplate(data);
      break;
    default:
      html = getCustomTemplate(data);
  }
  return compileTemplate(html, data);
}

export { TEMPLATE_TYPES };
