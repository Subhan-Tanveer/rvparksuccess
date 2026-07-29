// Guest account API — signup, login, logout, and dashboard data, all in one
// serverless function (same pattern as api/admin/auth.js) to stay under
// Vercel's Hobby-plan limit of 12 serverless functions per deployment.
//
// POST { action: 'signup' | 'login' | 'logout', ... }
// GET  → the logged-in guest's profile + booking history across all parks
import { createGuestSessionCookie, clearGuestSessionCookie, getGuestSession } from './_lib/auth.js';
import { createGuestAccount, verifyGuestLogin, getGuestByEmail, getBookingsForGuest, cancelReservationForGuest } from './_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getGuestSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    const guest = await getGuestByEmail(session.guestEmail);
    if (!guest) return res.status(401).json({ error: 'Not signed in' });

    return res.status(200).json({
      guest: { name: guest.name, email: guest.email, phone: guest.phone },
      bookings: await getBookingsForGuest(guest.email),
    });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'signup') {
      const { name, email, password, phone } = req.body;
      try {
        const guest = await createGuestAccount({ name, email, password, phone });
        res.setHeader('Set-Cookie', createGuestSessionCookie({ guestEmail: guest.email }));
        return res.status(200).json({ ok: true, name: guest.name });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (action === 'login') {
      const { email, password } = req.body;
      const guest = await verifyGuestLogin(email, password);
      if (!guest) return res.status(401).json({ error: 'Incorrect email or password' });

      res.setHeader('Set-Cookie', createGuestSessionCookie({ guestEmail: guest.email }));
      return res.status(200).json({ ok: true, name: guest.name });
    }

    if (action === 'cancel') {
      const session = getGuestSession(req);
      if (!session) return res.status(401).json({ error: 'Not signed in' });
      const { reservationId } = req.body;
      try {
        const reservation = await cancelReservationForGuest(reservationId, session.guestEmail);
        return res.status(200).json({ ok: true, reservation });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', clearGuestSessionCookie());
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
