// GET /api/admin/dashboard — park-staff only. Everything the staff
// dashboard needs on load, in one call: this park's info, its sites, and
// its recent reservations (both guest self-service and staff-entered).
import { requireSession } from '../_lib/auth.js';
import { getPark, getSitesForPark, getReservationsForPark } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const park = getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });
  const { passwordHash, ...safePark } = park;

  res.status(200).json({
    park: safePark,
    sites: getSitesForPark(session.parkId),
    reservations: getReservationsForPark(session.parkId),
  });
}
