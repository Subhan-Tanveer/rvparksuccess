// POST /api/admin/super-login — the platform owner's own login (not a park's).
// Requires SUPER_ADMIN_PASSWORD to be set in your Vercel environment
// variables — see README. Never put the actual password in any file here.
import { createSessionCookie } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};
  const expected = process.env.SUPER_ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'SUPER_ADMIN_PASSWORD is not configured — see README' });

  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  res.setHeader('Set-Cookie', createSessionCookie({ role: 'super-admin' }));
  res.status(200).json({ ok: true });
}
