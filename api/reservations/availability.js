// Vercel serverless function — GET /api/reservations/availability
// Returns which sites at a park are open for a given check-in/check-out
// date range, with pricing. See api/_lib/reservations-store.js for the
// data layer and its production-readiness caveats.
// POST — join the waitlist for a park/date range that's sold out. Folded
// into this route (rather than a new file) to stay under Vercel's
// Hobby-plan 12-function limit — it's already about availability for a
// park+date range, so a waitlist join fits the same surface.
import { getPark, getAvailableSites, joinWaitlist } from '../_lib/reservations-store.js';

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

  const { park: parkId, checkIn, checkOut, promo, guestEmail } = req.query;
  if (!parkId || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'park, checkIn, and checkOut are required' });
  }

  const park = await getPark(parkId);
  if (!park) return res.status(404).json({ error: 'Unknown park' });

  if (new Date(checkOut) <= new Date(checkIn)) {
    return res.status(400).json({ error: 'checkOut must be after checkIn' });
  }

  const sites = await getAvailableSites(parkId, checkIn, checkOut, promo || null, guestEmail || null);
  res.status(200).json({ park, checkIn, checkOut, sites });
}
