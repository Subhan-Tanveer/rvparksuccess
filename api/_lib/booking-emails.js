// Transactional booking emails — a guest confirmation and an owner "new
// booking" notification, sent from the same points a reservation becomes
// genuinely confirmed (see api/reservations/webhook.js, api/admin/
// dashboard.js, api/admin/ops.js). Deterministic templates, not the
// AI-drafted style used for waitlist-matcher.js's opportunity emails — a
// confirmation email needs to be reliable and identical every time, not
// creatively varied.
//
// Sent as the park owner's own connected Gmail (via the same "Connect
// Google Account" OAuth used for Calendar sync) when they've connected
// one, so a guest sees the actual park's email address, not a shared
// platform one — falls back to the shared sender in api/_lib/mailer.js
// for any park that hasn't connected, so this always sends either way.
import { sendEmail as sendViaSharedMailer } from './mailer.js';
import { sendEmailViaGmail } from './google-calendar.js';
import { renderEmail } from './email-template.js';

async function send(parkId, { to, subject, html }) {
  try {
    const sentAsOwner = await sendEmailViaGmail(parkId, { to, subject, html });
    if (sentAsOwner) return;
  } catch (err) {
    // Connected but the send itself failed (expired grant, API hiccup) —
    // fall through to the shared sender rather than losing the email.
    console.error('Owner Gmail send failed, falling back to shared sender:', err.message);
  }
  await sendViaSharedMailer({ to, subject, html });
}

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Best-effort — a failed send should never fail the booking that
// triggered it. Callers fire-and-catch this the same way they already do
// for Google Calendar sync and waitlist notifications.
export async function sendGuestConfirmationEmail(park, reservation, site) {
  if (!reservation.guestEmail) return; // staff can book without an email on file
  const directionsUrl = (park.latitude != null && park.longitude != null)
    ? `https://www.google.com/maps/dir/?api=1&destination=${park.latitude},${park.longitude}`
    : null;

  const html = renderEmail({
    eyebrow: 'Reservation Confirmed',
    title: `You're all set at ${park.name}!`,
    intro: `Hi ${reservation.guestName}, your reservation is confirmed${park.address ? ` at ${park.name} (${park.address})` : ''}. Here are your stay details.`,
    details: [
      ['Check-In', formatDate(reservation.checkIn)],
      ['Check-Out', formatDate(reservation.checkOut)],
      ['Site', site?.name || null],
      reservation.status === 'confirmed-deposit'
        ? ['Deposit Paid', formatUsd(reservation.depositCents)]
        : ['Total Paid', formatUsd(reservation.totalCents)],
      reservation.status === 'confirmed-deposit' ? ['Balance Due at Park', formatUsd(reservation.balanceCents)] : null,
    ].filter(Boolean),
    cta: directionsUrl ? { label: 'Get Directions', href: directionsUrl } : null,
    closing: `Questions about your stay? Reply to this email or contact the park directly${park.ownerPhone ? ` at ${park.ownerPhone}` : ''}. See you soon!`,
  });

  await send(park.id, {
    to: reservation.guestEmail,
    subject: `Confirmed: your stay at ${park.name}`,
    html,
  });
}

export async function sendOwnerBookingNotificationEmail(park, reservation, site) {
  if (!park.ownerEmail) return;
  const html = renderEmail({
    eyebrow: reservation.source === 'staff' ? 'New Booking (Staff-Entered)' : 'New Booking',
    title: `New reservation: ${reservation.guestName}`,
    intro: `${reservation.guestName} just booked ${site?.name || 'a site'} at ${park.name}.`,
    details: [
      ['Guest', reservation.guestName],
      ['Email', reservation.guestEmail],
      ['Phone', reservation.guestPhone],
      ['Site', site?.name || 'Unknown site'],
      ['Check-In', formatDate(reservation.checkIn)],
      ['Check-Out', formatDate(reservation.checkOut)],
      ['Total', formatUsd(reservation.totalCents)],
    ],
    cta: { label: 'View in Dashboard', href: 'https://www.rvparksuccess.com/park-dashboard.html#reservations' },
  });

  await send(park.id, {
    to: park.ownerEmail,
    subject: `New booking: ${reservation.guestName}, ${formatDate(reservation.checkIn)} – ${formatDate(reservation.checkOut)}`,
    html,
  });
}
