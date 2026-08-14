// GET /api/admin/crm endpoints for guest management, profiles, and communication
// POST /api/admin/crm endpoints for adding notes, tags, and preferences
// DELETE /api/admin/crm endpoints for removing tags
// All endpoints require park-staff session authentication
import { requireSession } from '../_lib/auth.js';
import {
  getGuestsForPark,
  getGuestHistory,
  addGuestNote,
  tagGuest,
  removeTag,
  updateGuestPreferences,
  getGuestSegments,
  identifyAtRiskGuests,
  logCommunication,
  getOrCreateGuestProfile,
} from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const parkId = session.parkId;
  const { action, guestEmail, tagId } = req.query;

  // GET /api/admin/crm/guests - list all guests for park with pagination
  if (req.method === 'GET' && action === 'guests') {
    try {
      const page = parseInt(req.query.page || '0', 10);
      const limit = 50;
      const offset = page * limit;

      const { guests, total } = await getGuestsForPark(parkId, limit, offset);

      return res.status(200).json({
        guests,
        total,
        page,
        limit,
        hasMore: offset + limit < total,
      });
    } catch (err) {
      console.error('Error listing guests:', err.message);
      return res.status(500).json({ error: 'Failed to load guests' });
    }
  }

  // GET /api/admin/crm/guest/:guestEmail - full guest profile
  if (req.method === 'GET' && action === 'guest' && guestEmail) {
    try {
      const history = await getGuestHistory(parkId, guestEmail);
      return res.status(200).json({ history });
    } catch (err) {
      console.error('Error loading guest history:', err.message);
      return res.status(500).json({ error: 'Failed to load guest profile' });
    }
  }

  // GET /api/admin/crm/segments - guest segmentation counts
  if (req.method === 'GET' && action === 'segments') {
    try {
      const segments = await getGuestSegments(parkId);
      return res.status(200).json({ segments });
    } catch (err) {
      console.error('Error loading segments:', err.message);
      return res.status(500).json({ error: 'Failed to load segments' });
    }
  }

  // GET /api/admin/crm/at-risk - list at-risk guests
  if (req.method === 'GET' && action === 'at-risk') {
    try {
      const limit = parseInt(req.query.limit || '10', 10);
      const guests = await identifyAtRiskGuests(parkId, limit);
      return res.status(200).json({ guests });
    } catch (err) {
      console.error('Error loading at-risk guests:', err.message);
      return res.status(500).json({ error: 'Failed to load at-risk guests' });
    }
  }

  // POST /api/admin/crm/note - add staff note to guest
  if (req.method === 'POST' && action === 'note') {
    const { guestEmail: email, noteText, staffId } = req.body;
    if (!email || !noteText) {
      return res.status(400).json({ error: 'Guest email and note text are required' });
    }

    try {
      const note = await addGuestNote(parkId, email, noteText, staffId);
      return res.status(201).json({ note });
    } catch (err) {
      console.error('Error adding note:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  // POST /api/admin/crm/tag - add tag to guest
  if (req.method === 'POST' && action === 'tag') {
    const { guestEmail: email, tagName } = req.body;
    if (!email || !tagName) {
      return res.status(400).json({ error: 'Guest email and tag name are required' });
    }

    try {
      const tag = await tagGuest(parkId, email, tagName);
      if (!tag) {
        return res.status(400).json({ error: 'Tag already exists on this guest' });
      }
      return res.status(201).json({ tag });
    } catch (err) {
      console.error('Error adding tag:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  // DELETE /api/admin/crm/tag/:tagId - remove tag from guest
  if (req.method === 'DELETE' && action === 'tag' && tagId) {
    try {
      const success = await removeTag(parkId, tagId);
      if (!success) {
        return res.status(404).json({ error: 'Tag not found' });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Error removing tag:', err.message);
      return res.status(500).json({ error: 'Failed to remove tag' });
    }
  }

  // POST /api/admin/crm/preferences - update guest preferences
  if (req.method === 'POST' && action === 'preferences') {
    const { guestEmail: email, preferences } = req.body;
    if (!email || !preferences) {
      return res.status(400).json({ error: 'Guest email and preferences are required' });
    }

    try {
      const updated = await updateGuestPreferences(parkId, email, preferences);
      return res.status(200).json({ profile: updated });
    } catch (err) {
      console.error('Error updating preferences:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  // POST /api/admin/crm/communication - log communication event
  if (req.method === 'POST' && action === 'communication') {
    const { guestEmail: email, type, subject, messagePreview, status } = req.body;
    if (!email || !type) {
      return res.status(400).json({ error: 'Guest email and communication type are required' });
    }

    try {
      const comm = await logCommunication(parkId, email, { type, subject, messagePreview, status });
      return res.status(201).json({ communication: comm });
    } catch (err) {
      console.error('Error logging communication:', err.message);
      return res.status(500).json({ error: 'Failed to log communication' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
