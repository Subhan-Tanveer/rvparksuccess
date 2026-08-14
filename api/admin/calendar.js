// GET /api/admin/calendar — Returns calendar data (sites, reservations, blocked dates) for a given month
// POST /api/admin/calendar — Create reservation or block dates
// PUT /api/admin/calendar — Move reservation to different dates/site
// DELETE /api/admin/calendar — Unblock dates or cancel reservations

import { requireSession } from '../_lib/auth.js';
import {
  getPark,
  getSitesForPark,
  getReservationsForPark,
  getBlockedDatesForPark,
  createReservation,
  moveReservation,
  blockDates,
  unblockDate,
  cancelReservation,
  addBlockedDate,
  removeBlockedDate,
  getReservationById,
} from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method === 'GET') {
    try {
      const { parkId, month } = req.query;

      if (!parkId || parkId !== session.parkId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const park = await getPark(parkId);
      if (!park) return res.status(404).json({ error: 'Park not found' });

      // Parse the month string (YYYY-MM) to get the date range
      const [yearStr, monthStr] = month.split('-');
      const startDate = new Date(`${yearStr}-${monthStr}-01`);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0); // Last day of month

      const sites = await getSitesForPark(parkId);
      const reservations = await getReservationsForPark(parkId, startDate, endDate);
      const blockedDates = await getBlockedDatesForPark(parkId, startDate, endDate);

      // Format reservations for calendar
      const formattedReservations = reservations.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        guestName: r.guestName,
        guestPhone: r.guestPhone || null,
        guestEmail: r.guestEmail || null,
        checkInDate: r.checkInDate.toISOString().split('T')[0],
        checkOutDate: r.checkOutDate.toISOString().split('T')[0],
        totalCents: r.totalCents,
        status: r.status, // 'pending', 'confirmed', etc.
      }));

      // Format blocked dates
      const formattedBlockedDates = blockedDates.map((b) => ({
        siteId: b.siteId,
        date: b.date.toISOString().split('T')[0],
        reason: b.reason || null,
      }));

      // Format sites
      const formattedSites = sites.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        capacity: s.capacity,
        nightlyRateCents: s.nightlyRateCents,
      }));

      return res.status(200).json({
        sites: formattedSites,
        reservations: formattedReservations,
        blockedDates: formattedBlockedDates,
      });
    } catch (err) {
      console.error('Calendar GET error:', err);
      return res.status(500).json({ error: 'Failed to load calendar data' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { action, siteId, guestName, guestPhone, checkInDate, checkOutDate, reason } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'Missing action' });
      }

      if (action === 'create-reservation') {
        if (!siteId || !guestName || !checkInDate || !checkOutDate) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const checkIn = new Date(checkInDate + 'T00:00:00Z');
        const checkOut = new Date(checkOutDate + 'T00:00:00Z');

        if (checkOut <= checkIn) {
          return res.status(400).json({ error: 'Invalid dates' });
        }

        const reservation = await createReservation({
          parkId: session.parkId,
          siteId,
          guestName,
          guestPhone: guestPhone || null,
          guestEmail: null,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          source: 'staff',
          status: 'confirmed',
          paymentMethod: 'cash',
        });

        return res.status(201).json({
          success: true,
          reservation: {
            id: reservation.id,
            siteId: reservation.siteId,
            guestName: reservation.guestName,
            checkInDate: reservation.checkInDate.toISOString().split('T')[0],
            checkOutDate: reservation.checkOutDate.toISOString().split('T')[0],
            totalCents: reservation.totalCents,
          },
        });
      }

      if (action === 'block-dates') {
        if (!siteId || !checkInDate || !checkOutDate) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const checkIn = new Date(checkInDate + 'T00:00:00Z');
        const checkOut = new Date(checkOutDate + 'T00:00:00Z');

        if (checkOut < checkIn) {
          return res.status(400).json({ error: 'Invalid dates' });
        }

        // Block each day in the range
        const current = new Date(checkIn);
        while (current < checkOut) {
          await addBlockedDate({
            parkId: session.parkId,
            siteId,
            date: current,
            reason: reason || 'Blocked by staff',
          });
          current.setDate(current.getDate() + 1);
        }

        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Calendar POST error:', err);
      return res.status(500).json({ error: 'Failed to process request' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { action, reservationId, newSiteId, newCheckInDate, newCheckOutDate } = req.body;

      if (action === 'move-reservation') {
        if (!reservationId || !newSiteId || !newCheckInDate || !newCheckOutDate) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const reservation = await getReservationById(reservationId);
        if (!reservation || reservation.parkId !== session.parkId) {
          return res.status(404).json({ error: 'Reservation not found' });
        }

        const checkIn = new Date(newCheckInDate + 'T00:00:00Z');
        const checkOut = new Date(newCheckOutDate + 'T00:00:00Z');

        if (checkOut <= checkIn) {
          return res.status(400).json({ error: 'Invalid dates' });
        }

        const updated = await moveReservation(reservationId, newSiteId, checkIn, checkOut);

        return res.status(200).json({
          success: true,
          reservation: {
            id: updated.id,
            siteId: updated.siteId,
            checkInDate: updated.checkInDate.toISOString().split('T')[0],
            checkOutDate: updated.checkOutDate.toISOString().split('T')[0],
          },
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Calendar PUT error:', err);
      return res.status(500).json({ error: 'Failed to update reservation' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { action, siteId, date, reservationId } = req.body;

      if (action === 'unblock-date') {
        if (!siteId || !date) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        await removeBlockedDate(session.parkId, siteId, new Date(date + 'T00:00:00Z'));
        return res.status(200).json({ success: true });
      }

      if (action === 'cancel-reservation') {
        if (!reservationId) {
          return res.status(400).json({ error: 'Missing reservation ID' });
        }

        const reservation = await getReservationById(reservationId);
        if (!reservation || reservation.parkId !== session.parkId) {
          return res.status(404).json({ error: 'Reservation not found' });
        }

        await cancelReservation(reservationId);
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Calendar DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
