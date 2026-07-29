// Unified auth API for customers and RVPark owners
// POST { role: 'customer' | 'owner', action: 'signup' | 'login' | 'logout', ... }
import { createGuestSessionCookie, clearGuestSessionCookie, getGuestSession } from './_lib/auth.js';
import { createGuestAccount, verifyGuestLogin, getGuestByEmail } from './_lib/reservations-store.js';
import { createParkAccount, verifyParkOwnerLogin, getParkByOwnerEmail } from './_lib/owner-store.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getGuestSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });

    // Determine if customer or owner based on session
    const role = session.role || 'customer';

    if (role === 'customer') {
      const guest = getGuestByEmail(session.guestEmail);
      if (!guest) return res.status(401).json({ error: 'Not signed in' });
      return res.status(200).json({ guest: { name: guest.name, email: guest.email, phone: guest.phone } });
    } else if (role === 'owner') {
      const park = getParkByOwnerEmail(session.ownerEmail);
      if (!park) return res.status(401).json({ error: 'Not signed in' });
      return res.status(200).json({ park: { name: park.name, location: park.location, parkId: park.id } });
    }

    return res.status(400).json({ error: 'Invalid role' });
  }

  if (req.method === 'POST') {
    const { role, action } = req.body || {};

    if (role === 'customer') {
      if (action === 'signup') {
        const { name, email, password, phone } = req.body;
        try {
          const guest = createGuestAccount({ name, email, password, phone });
          res.setHeader('Set-Cookie', createGuestSessionCookie({ guestEmail: guest.email, role: 'customer' }));
          return res.status(200).json({ ok: true, name: guest.name });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      if (action === 'login') {
        const { email, password } = req.body;
        const guest = verifyGuestLogin(email, password);
        if (!guest) return res.status(401).json({ error: 'Incorrect email or password' });

        res.setHeader('Set-Cookie', createGuestSessionCookie({ guestEmail: guest.email, role: 'customer' }));
        return res.status(200).json({ ok: true, name: guest.name });
      }
    } else if (role === 'owner') {
      if (action === 'signup') {
        const { parkName, location, ownerName, email, phone, password } = req.body;
        try {
          const park = createParkAccount({ parkName, location, ownerName, email, phone, password });
          res.setHeader('Set-Cookie', createGuestSessionCookie({ ownerEmail: email, role: 'owner' }));
          return res.status(200).json({ ok: true, parkId: park.id, parkName: park.name });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      if (action === 'login') {
        const { email, password } = req.body;
        const park = verifyParkOwnerLogin(email, password);
        if (!park) return res.status(401).json({ error: 'Incorrect email or password' });

        res.setHeader('Set-Cookie', createGuestSessionCookie({ ownerEmail: email, role: 'owner' }));
        return res.status(200).json({ ok: true, parkId: park.id, parkName: park.name });
      }
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', clearGuestSessionCookie());
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action or role' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
