// GET/POST /api/admin/parks — super-admin only.
// GET: list every park (for the dashboard table).
// POST: create a new park + set its staff login credentials.
import { requireSession } from '../_lib/auth.js';
import { createPark, listParksForAdmin } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'super-admin' });
  if (!session) return; // requireSession already sent the 401

  if (req.method === 'GET') {
    return res.status(200).json({ parks: listParksForAdmin() });
  }

  if (req.method === 'POST') {
    const { name, location, state, timezone, staffUsername, staffPassword } = req.body || {};
    try {
      const park = createPark({ name, location, state, timezone, staffUsername, staffPassword });
      const { passwordHash, ...safePark } = park;
      return res.status(201).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
}
