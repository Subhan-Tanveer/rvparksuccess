// POST /api/admin/auth — handles all three login/logout actions in one
// serverless function (super-admin login, park-staff login, logout).
// Combined into a single file to stay under Vercel's Hobby-plan limit of
// 12 serverless functions per deployment — these three were small enough
// to share one file without hurting readability.
import { createSessionCookie, clearSessionCookie } from '../_lib/auth.js';
import { verifyParkLogin, signupParkOwner } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  if (action === 'super-login') {
    const { password } = req.body;
    const expected = process.env.SUPER_ADMIN_PASSWORD;
    if (!expected) return res.status(500).json({ error: 'SUPER_ADMIN_PASSWORD is not configured — see README' });
    if (!password || password !== expected) return res.status(401).json({ error: 'Incorrect password' });

    res.setHeader('Set-Cookie', createSessionCookie({ role: 'super-admin' }));
    return res.status(200).json({ ok: true });
  }

  if (action === 'park-login') {
    const { username, password } = req.body;
    const park = await verifyParkLogin(username, password);
    if (!park) return res.status(401).json({ error: 'Incorrect username or password' });

    res.setHeader('Set-Cookie', createSessionCookie({ role: 'park-staff', parkId: park.id }));
    return res.status(200).json({ ok: true, parkName: park.name });
  }

  if (action === 'owner-signup') {
    const { parkName, location, ownerName, email, phone, password } = req.body;
    try {
      const park = await signupParkOwner({ parkName, location, ownerName, email, phone, password });
      res.setHeader('Set-Cookie', createSessionCookie({ role: 'park-staff', parkId: park.id }));
      return res.status(200).json({ ok: true, parkName: park.name });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }

  res.status(400).json({ error: 'Unknown action' });
}
