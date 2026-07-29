// POST /api/admin/staff-booking — park-staff only. This is what the front
// desk uses for a phone or walk-in reservation: same underlying data as
// the guest-facing booking flow, so a site booked here is instantly
// unavailable everywhere else too — nothing to keep in sync.
import { requireSession } from '../_lib/auth.js';
import { createStaffReservation } from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { siteId, checkIn, checkOut, guestName, guestEmail, guestPhone, paymentMethod, notes } = req.body || {};
  try {
    const reservation = await createStaffReservation({
      parkId: session.parkId, siteId, checkIn, checkOut,
      guestName, guestEmail, guestPhone, paymentMethod, notes,
    });
    res.status(201).json({ reservation });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
