// GET /api/admin/dashboard — park-staff only. Everything the staff
// dashboard needs on load, in one call: this park's info, its sites, and
// its recent reservations (both guest self-service and staff-entered).
// POST — update this park's own settings (tax rate, deposit %). Combined
// into the same route rather than a new file to stay under Vercel's
// Hobby-plan 12-function limit.
import { requireSession } from '../_lib/auth.js';
import { getPark, getSitesForPark, getReservationsForPark, updateParkSettings, getParkStats, addPromoCode, removePromoCode, getWaitlistForPark, removeWaitlistEntry, getPayoutSummary } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method === 'POST' && req.body?.resource === 'promo') {
    const { code, type, value } = req.body;
    try {
      const park = addPromoCode(session.parkId, { code, type, value });
      const { passwordHash, ...safePark } = park;
      return res.status(201).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'promo') {
    try {
      const park = removePromoCode(session.parkId, req.body.promoId);
      const { passwordHash, ...safePark } = park;
      return res.status(200).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'waitlist') {
    try {
      removeWaitlistEntry(req.body.entryId, session.parkId);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const park = updateParkSettings(session.parkId, req.body || {});
      const { passwordHash, ...safePark } = park;
      return res.status(200).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const park = getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });
  const { passwordHash, ...safePark } = park;

  res.status(200).json({
    park: safePark,
    sites: getSitesForPark(session.parkId),
    reservations: getReservationsForPark(session.parkId),
    stats: getParkStats(session.parkId),
    waitlist: getWaitlistForPark(session.parkId),
    payout: getPayoutSummary(session.parkId),
  });
}
