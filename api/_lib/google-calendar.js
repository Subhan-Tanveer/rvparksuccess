// One-way Google Calendar sync — a park's reservations get pushed to
// whatever Google Calendar the park owner connected, as read-only-in-
// intent events (we never read changes back from Google; the dashboard
// stays the single source of truth for availability/payment). Deliberately
// plain fetch() against Google's REST APIs rather than the `googleapis`
// npm package — that package pulls in a large dependency tree for what's
// really three small HTTP calls (token exchange, token refresh, event
// CRUD), matching this app's existing preference for a minimal
// hand-rolled client over a heavy SDK (see api/_lib/mailer.js).
import {
  getGoogleCalendarCredentials,
  setReservationGoogleEventId,
  getReservationGoogleEventId,
} from './reservations-store.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email';

function requireEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google Calendar is not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing)');
  return { clientId, clientSecret };
}

// `state` carries the parkId through Google's redirect so the callback
// knows which park to connect — signed by requireSession on the way in
// (the callback still requires a valid staff session for that park, state
// alone is not treated as authorization) and just used to route which
// park's tokens get saved once the callback confirms who's logged in.
export function getGoogleAuthUrl(redirectUri, state) {
  const { clientId } = requireEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // Google only returns a refresh_token on the FIRST consent for a given
    // account+app — prompt=consent forces the consent screen (and a fresh
    // refresh_token) every time, so reconnecting after a disconnect works
    // instead of silently getting no refresh_token back on the 2nd+ try.
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code, redirectUri) {
  const { clientId, clientSecret } = requireEnv();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data; // { access_token, refresh_token, expires_in, ... } — refresh_token only present on first consent
}

async function getAccessToken(refreshToken) {
  const { clientId, clientSecret } = requireEnv();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Could not refresh Google access token');
  return data.access_token;
}

export async function getGoogleAccountEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

function reservationToEventBody(park, reservation) {
  return {
    summary: `${reservation.guestName} — ${park.name || 'RV Park'}`,
    description: [
      `Booked via RVPark Success`,
      reservation.guestPhone ? `Phone: ${reservation.guestPhone}` : null,
      reservation.guestEmail ? `Email: ${reservation.guestEmail}` : null,
      `Status: ${reservation.status}`,
    ].filter(Boolean).join('\n'),
    start: { date: reservation.checkIn },   // all-day event — check-in date
    end: { date: reservation.checkOut },    // Google's all-day `end.date` is already exclusive, matching checkOut's own meaning
  };
}

// Called after a reservation is created or its dates/guest info change.
// Creates the event on first sync, updates it on every call after (using
// the saved google_event_id) — so this is safe to call on every save, not
// just once. Never throws to the caller of the caller: sync failures are
// logged and swallowed by the functions below, since a Google Calendar
// hiccup should never block a real booking from succeeding.
export async function syncReservationToGoogleCalendar(park, reservation) {
  const creds = await getGoogleCalendarCredentials(park.id);
  if (!creds) return; // this park hasn't connected a calendar — nothing to do

  const accessToken = await getAccessToken(creds.refreshToken);
  const existingEventId = await getReservationGoogleEventId(reservation.id);
  const body = reservationToEventBody(park, reservation);

  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(creds.calendarId)}/events/${encodeURIComponent(existingEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(creds.calendarId)}/events`;

  const res = await fetch(url, {
    method: existingEventId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    // The saved event was deleted on Google's side (someone deleted it
    // directly in Calendar, or the calendar itself was removed) — the
    // PATCH 404s. Clear the stale id and recurse once to create a fresh
    // event, rather than leaving this reservation permanently out of sync
    // (or looping forever — clearing it first means the recursive call
    // sees no existingEventId and takes the POST/create path, not PATCH).
    if (res.status === 404 && existingEventId) {
      await setReservationGoogleEventId(reservation.id, null);
      return syncReservationToGoogleCalendar(park, reservation);
    }
    throw new Error(data.error?.message || 'Google Calendar sync failed');
  }

  if (!existingEventId) await setReservationGoogleEventId(reservation.id, data.id);
}

export async function deleteReservationFromGoogleCalendar(parkId, reservation) {
  const creds = await getGoogleCalendarCredentials(parkId);
  if (!creds) return;
  const eventId = await getReservationGoogleEventId(reservation.id);
  if (!eventId) return; // never synced (e.g. calendar wasn't connected when it was booked) — nothing to delete

  const accessToken = await getAccessToken(creds.refreshToken);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(creds.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  // 410 Gone = already deleted on Google's side — treat as success either way.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || 'Could not remove Google Calendar event');
  }
}
