// Syncs a confirmed reservation into GoHighLevel (GHL) as a contact +
// a note recording the booking, so existing GHL automations (review
// requests, upsell follow-ups) pick guests up automatically — per
// Marie's ask (see README). Requires a GHL Private Integration Token
// (Settings → Private Integrations, on the target sub-account) with the
// "Contacts" scope, and that sub-account's location id.
//
// Best-effort, like the Google Calendar sync and confirmation emails
// this runs alongside in the reservation webhook: a GHL outage or
// misconfigured token must never fail the webhook itself. Returns
// immediately (no-op) if GHL isn't configured, so this is safe to leave
// wired in for parks/deployments that never set it up.
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatUsd(cents) {
  return '$' + ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function ghlRequest(path, options) {
  const res = await fetch(`${GHL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GHL ${path} failed (${res.status}): ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

export async function syncReservationToGhl(park, reservation) {
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) return;
  if (!reservation.guestEmail) return; // upsert dedupes on email; nothing to key on without it

  const { firstName, lastName } = splitName(reservation.guestName);

  const contactRes = await ghlRequest('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({
      locationId: process.env.GHL_LOCATION_ID,
      firstName,
      lastName,
      email: reservation.guestEmail,
      phone: reservation.guestPhone || undefined,
      source: 'RVPark Success Reservation',
      tags: ['RVPark Success Guest', park.name].filter(Boolean),
    }),
  });

  const contactId = contactRes.contact?.id;
  if (!contactId) return;

  // A note, not a custom field, so this works for every account regardless
  // of whether Marie has set up matching custom fields on the location.
  await ghlRequest(`/contacts/${contactId}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      body: `New RVPark Success booking at ${park.name}: ${formatDate(reservation.checkIn)} → ${formatDate(reservation.checkOut)} (${reservation.nights} night${reservation.nights === 1 ? '' : 's'}), total ${formatUsd(reservation.totalCents)}.`,
    }),
  }).catch((err) => console.error('GHL note failed (non-fatal):', err.message));
}
