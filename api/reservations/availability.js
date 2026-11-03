// Vercel serverless function — GET /api/reservations/availability
// Returns which sites at a park are open for a given check-in/check-out
// date range, with pricing. See api/_lib/reservations-store.js for the
// data layer and its production-readiness caveats.
// POST — join the waitlist for a park/date range that's sold out. Folded
// into this route (rather than a new file) to stay under Vercel's
// Hobby-plan 12-function limit — it's already about availability for a
// park+date range, so a waitlist join fits the same surface.
// GET ?siteId=X&format=ical — a per-site iCalendar (.ics) feed of booked/
// blocked dates, for pasting into Hipcamp/Airbnb/VRBO's calendar sync
// (see park-dashboard.html's "Copy Calendar Link"). Folded in here for
// the same function-count reason rather than its own file.
import { getParkWithMedia, getAvailableSites, joinWaitlist, suggestNearbyAvailability, sanitizeParkForPublic, getSite, getReservationsBySiteInRange, getBlackoutDatesByDateRange } from '../_lib/reservations-store.js';

const ICAL_MONTHS_AHEAD = 18;

function toIcsDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function escapeIcsText(text) {
  return String(text).replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

function foldLine(line) {
  // RFC 5545 requires folding lines longer than 75 octets — none of ours
  // get that long today, but this keeps the feed spec-compliant if a
  // future field (e.g. a longer reason) pushes past that.
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  for (let i = 75; i < line.length; i += 74) out += `\r\n ${line.slice(i, i + 74)}`;
  return out;
}

function buildIcsFeed({ siteName, events }) {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RVParkSuccess//Reservation Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(siteName)} — Booked Dates`,
  ];

  events.forEach((event) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@rvparksuccess.com`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${toIcsDate(event.start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(event.end)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Deliberately public (no auth) — that's how every iCal calendar-sync URL
// works industry-wide (Airbnb, Google Calendar, etc. all use an
// unguessable-but-unauthenticated link, not a login). Never includes
// guest name/email/phone — only date ranges, like syncing a "Busy"
// calendar.
async function sendIcalFeed(req, res, siteId) {
  const site = await getSite(siteId);
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const today = new Date();
  const rangeEnd = new Date(today);
  rangeEnd.setMonth(rangeEnd.getMonth() + ICAL_MONTHS_AHEAD);
  const startStr = today.toISOString().split('T')[0];
  const endStr = rangeEnd.toISOString().split('T')[0];

  const [reservations, blackouts] = await Promise.all([
    getReservationsBySiteInRange(siteId, startStr, endStr),
    getBlackoutDatesByDateRange(siteId, startStr, endStr),
  ]);

  const events = [
    ...reservations
      .filter((r) => r.status !== 'canceled')
      .map((r) => ({ uid: `res-${r.id}`, start: r.checkIn, end: r.checkOut, summary: 'Booked' })),
    // mapBlackoutDate() (unlike every other mapper in this file) returns
    // snake_case start_date/end_date — matching that here rather than
    // "fixing" it, since validateBooking() already correctly depends on
    // that exact shape.
    ...blackouts.map((b) => ({ uid: `blackout-${b.id}`, start: b.start_date, end: b.end_date, summary: b.reason || 'Unavailable' })),
  ];

  const ics = buildIcsFeed({ siteName: site.name, events });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${site.id}.ics"`);
  // OTAs typically poll every few hours — a short cache avoids hammering
  // the database on every sync check while still staying reasonably
  // fresh for same-day availability changes.
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.status(200).send(ics);
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { parkId, checkIn, checkOut, name, email, phone, notes } = req.body || {};
    try {
      const entry = await joinWaitlist({ parkId, checkIn, checkOut, name, email, phone, notes });
      return res.status(201).json({ entry });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.query.format === 'ical') {
    if (!req.query.siteId) return res.status(400).json({ error: 'siteId is required' });
    return sendIcalFeed(req, res, req.query.siteId);
  }

  const { park: parkId, checkIn, checkOut, promo, guestEmail } = req.query;
  if (!parkId || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'park, checkIn, and checkOut are required' });
  }

  const park = await getParkWithMedia(parkId);
  if (!park) return res.status(404).json({ error: 'Unknown park' });

  if (new Date(checkOut) <= new Date(checkIn)) {
    return res.status(400).json({ error: 'checkOut must be after checkIn' });
  }

  const sites = await getAvailableSites(parkId, checkIn, checkOut, promo || null, guestEmail || null);

  // Only look for alternatives when the exact search came up empty — this
  // is extra DB work, so skip it on the (much more common) case where the
  // search already found something.
  const suggestions = sites.length ? [] : await suggestNearbyAvailability(parkId, checkIn, checkOut);

  res.status(200).json({ park: sanitizeParkForPublic(park), checkIn, checkOut, sites, suggestions });
}
