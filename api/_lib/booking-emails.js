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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Best-effort — a failed send should never fail the booking that
// triggered it. Callers fire-and-catch this the same way they already do
// for Google Calendar sync and waitlist notifications.
export async function sendGuestConfirmationEmail(park, reservation, site) {
  if (!reservation.guestEmail) return; // staff can book without an email on file
  const balanceLine = reservation.status === 'confirmed-deposit'
    ? `<p>Deposit paid: <strong>${formatUsd(reservation.depositCents)}</strong> — balance of <strong>${formatUsd(reservation.balanceCents)}</strong> due at the park.</p>`
    : `<p>Total paid: <strong>${formatUsd(reservation.totalCents)}</strong></p>`;
  const directionsLine = (park.latitude != null && park.longitude != null)
    ? `<p><a href="https://www.google.com/maps/dir/?api=1&destination=${park.latitude},${park.longitude}">Get Directions</a></p>`
    : '';

  const html = `
    <h2>Your reservation is confirmed!</h2>
    <p>Hi ${escapeHtml(reservation.guestName)},</p>
    <p>You're all set at <strong>${escapeHtml(park.name)}</strong>${park.address ? ` (${escapeHtml(park.address)})` : ''}.</p>
    <p>
      <strong>Check-In:</strong> ${formatDate(reservation.checkIn)}<br>
      <strong>Check-Out:</strong> ${formatDate(reservation.checkOut)}<br>
      ${site?.name ? `<strong>Site:</strong> ${escapeHtml(site.name)}<br>` : ''}
    </p>
    ${balanceLine}
    ${directionsLine}
    <p>Questions about your stay? Reply to this email or contact the park directly${park.ownerPhone ? ` at ${escapeHtml(park.ownerPhone)}` : ''}.</p>
    <p>See you soon!</p>
  `;

  await send(park.id, {
    to: reservation.guestEmail,
    subject: `Confirmed: your stay at ${park.name}`,
    html,
  });
}

export async function sendOwnerBookingNotificationEmail(park, reservation, site) {
  if (!park.ownerEmail) return;
  const html = `
    <h2>New booking${reservation.source === 'staff' ? ' (staff-entered)' : ''}</h2>
    <p>
      <strong>Guest:</strong> ${escapeHtml(reservation.guestName)}<br>
      ${reservation.guestEmail ? `<strong>Email:</strong> ${escapeHtml(reservation.guestEmail)}<br>` : ''}
      ${reservation.guestPhone ? `<strong>Phone:</strong> ${escapeHtml(reservation.guestPhone)}<br>` : ''}
      <strong>Site:</strong> ${escapeHtml(site?.name || 'Unknown site')}<br>
      <strong>Check-In:</strong> ${formatDate(reservation.checkIn)}<br>
      <strong>Check-Out:</strong> ${formatDate(reservation.checkOut)}<br>
      <strong>Total:</strong> ${formatUsd(reservation.totalCents)}
    </p>
    <p><a href="https://www.rvparksuccess.com/park-dashboard.html#reservations">View in Dashboard</a></p>
  `;

  await send(park.id, {
    to: park.ownerEmail,
    subject: `New booking: ${reservation.guestName}, ${formatDate(reservation.checkIn)} – ${formatDate(reservation.checkOut)}`,
    html,
  });
}
