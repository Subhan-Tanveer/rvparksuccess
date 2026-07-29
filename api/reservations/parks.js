// Vercel serverless function — GET /api/reservations/parks
// Powers the "Find a Park" search: returns every RVPark Success client
// park, optionally filtered by a free-text location query (matches
// against park name, city/location, and state).
import { listParks } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { location } = req.query;
  const parks = await listParks(location || '');
  res.status(200).json({ parks });
}
