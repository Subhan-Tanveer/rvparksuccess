// POST/PUT/DELETE /api/admin/sites — park-staff only, scoped to their own
// park. The parkId always comes from the signed session, never from the
// request body — a staff member can never edit another park's sites, even
// if they tampered with the request.
import { requireSession } from '../_lib/auth.js';
import { addSite, updateSite, deleteSite, addSeasonalRate, removeSeasonalRate } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method === 'POST' && req.body?.resource === 'season') {
    const { siteId, label, startDate, endDate, nightlyRateCents } = req.body;
    try {
      const site = addSeasonalRate(siteId, session.parkId, { label, startDate, endDate, nightlyRateCents });
      return res.status(201).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && req.body?.resource === 'season') {
    const { siteId, seasonId } = req.body;
    try {
      const site = removeSeasonalRate(siteId, session.parkId, seasonId);
      return res.status(200).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { name, type, capacity, nightlyRateCents } = req.body || {};
    try {
      const site = addSite(session.parkId, { name, type, capacity, nightlyRateCents });
      return res.status(201).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const { id, name, type, capacity, nightlyRateCents } = req.body || {};
    try {
      const site = updateSite(id, session.parkId, { name, type, capacity, nightlyRateCents });
      return res.status(200).json({ site });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    try {
      deleteSite(id, session.parkId);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
}
