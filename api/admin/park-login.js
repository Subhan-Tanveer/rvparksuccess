// POST /api/admin/park-login — a specific park's staff login.
// Credentials are set by the super-admin when the park is created
// (see api/admin/parks.js).
import { createSessionCookie } from '../_lib/auth.js';
import { verifyParkLogin } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  const park = verifyParkLogin(username, password);
  if (!park) return res.status(401).json({ error: 'Incorrect username or password' });

  res.setHeader('Set-Cookie', createSessionCookie({ role: 'park-staff', parkId: park.id }));
  res.status(200).json({ ok: true, parkName: park.name });
}
