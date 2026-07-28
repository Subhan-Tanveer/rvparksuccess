// Vercel serverless function — GET /api/reservations/availability
// Returns which sites at a park are open for a given check-in/check-out
// date range, with pricing. See api/_lib/reservations-store.js for the
// data layer and its production-readiness caveats.
import { getPark, getAvailableSites } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { park: parkId, checkIn, checkOut } = req.query;
  if (!parkId || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'park, checkIn, and checkOut are required' });
  }

  const park = getPark(parkId);
  if (!park) return res.status(404).json({ error: 'Unknown park' });

  if (new Date(checkOut) <= new Date(checkIn)) {
    return res.status(400).json({ error: 'checkOut must be after checkIn' });
  }

  const sites = getAvailableSites(parkId, checkIn, checkOut);
  res.status(200).json({ park, checkIn, checkOut, sites });
}
