/**
 * Booking Rules API
 * Endpoints for managing booking rules, validation, and testing
 */

import { v4 as uuid } from 'uuid';
import { ensureAuth } from '../_lib/auth.js';
import { getStore } from '../_lib/reservations-store.js';
import {
  validateBooking,
  calculateBookingCost,
  enforceCancellationPolicy,
  checkRuleConflicts,
} from '../_lib/booking-rules-engine.js';

const store = getStore();

/**
 * GET /api/admin/booking-rules
 * Get all rules for a park
 */
export async function GET(req) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  const parkId = new URL(req.url).searchParams.get('parkId');
  if (!parkId) {
    return new Response(
      JSON.stringify({ error: 'parkId is required' }),
      { status: 400 }
    );
  }

  try {
    const rules = await store.getBookingRules(parkId);
    return new Response(JSON.stringify(rules), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] GET error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * GET /api/admin/booking-rules/:siteId
 * Get rules for a specific site
 */
export async function getBysite(req, { params }) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  const { siteId } = params;

  try {
    const rules = await store.getBookingRulesBySite(siteId);
    return new Response(JSON.stringify(rules), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] GET site rules error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * POST /api/admin/booking-rules
 * Create a new booking rule
 */
export async function POST(req) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  try {
    const body = await req.json();
    const {
      parkId,
      siteId,
      ruleType,
      ruleConfig,
      isActive = true,
      priority = 0,
    } = body;

    // Validate required fields
    if (!parkId || !ruleType || !ruleConfig) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    // Check for conflicts with existing rules
    const existingRules = await store.getBookingRules(parkId, siteId);
    const newRule = {
      rule_type: ruleType,
      rule_config_json: JSON.stringify(ruleConfig),
    };

    const { hasConflict, conflicts } = checkRuleConflicts(
      newRule,
      existingRules
    );

    if (hasConflict) {
      return new Response(
        JSON.stringify({ error: 'Rule conflicts detected', conflicts }),
        { status: 400 }
      );
    }

    // Create the rule
    const ruleId = uuid();
    await store.createBookingRule({
      id: ruleId,
      park_id: parkId,
      site_id: siteId,
      rule_type: ruleType,
      rule_config_json: JSON.stringify(ruleConfig),
      is_active: isActive,
      priority,
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ id: ruleId }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] POST error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * PATCH /api/admin/booking-rules/:ruleId
 * Update an existing rule
 */
export async function PATCH(req, { params }) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  const { ruleId } = params;

  try {
    const body = await req.json();
    const { isActive, ruleConfig, priority } = body;

    // Update the rule
    await store.updateBookingRule(ruleId, {
      is_active: isActive,
      rule_config_json: ruleConfig ? JSON.stringify(ruleConfig) : undefined,
      priority,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] PATCH error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * DELETE /api/admin/booking-rules/:ruleId
 * Delete a rule
 */
export async function DELETE(req, { params }) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  const { ruleId } = params;

  try {
    await store.deleteBookingRule(ruleId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] DELETE error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * POST /api/admin/booking-rules/validate
 * Test if a booking is valid
 */
export async function testBooking(req) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { parkId, siteId, checkIn, checkOut, guestCount = 1 } = body;

    if (!parkId || !siteId || !checkIn || !checkOut) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    // Validate the booking
    const result = await validateBooking(
      {
        checkIn,
        checkOut,
        siteId,
        parkId,
        guestCount,
      },
      store
    );

    // Get booking cost
    const site = await store.getSiteById(siteId);
    const costData = await calculateBookingCost(
      { checkIn, checkOut },
      site,
      store,
      parkId
    );

    return new Response(
      JSON.stringify({
        ...result,
        cost: costData,
      }),
      {
        headers: { 'content-type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('[booking-rules API] test booking error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * POST /api/admin/booking-rules/cancellation-test
 * Test cancellation policy
 */
export async function testCancellation(req) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { parkId, reservationId, cancellationDate } = body;

    if (!parkId || !reservationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    const reservation = await store.getReservationById(reservationId);
    if (!reservation) {
      return new Response(
        JSON.stringify({ error: 'Reservation not found' }),
        { status: 404 }
      );
    }

    const cancelDate = new Date(cancellationDate || new Date());
    const result = await enforceCancellationPolicy(
      reservation,
      cancelDate,
      store
    );

    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] test cancellation error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * GET /api/admin/booking-rules/blackout-dates
 * Get all blackout dates for park/site
 */
export async function getBlackouts(req) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  const url = new URL(req.url);
  const parkId = url.searchParams.get('parkId');
  const siteId = url.searchParams.get('siteId');

  if (!parkId) {
    return new Response(
      JSON.stringify({ error: 'parkId is required' }),
      { status: 400 }
    );
  }

  try {
    const blackouts = await store.getBlackoutDates(parkId, siteId);
    return new Response(JSON.stringify(blackouts), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] get blackouts error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * POST /api/admin/booking-rules/blackout-dates
 * Create a blackout period
 */
export async function createBlackout(req) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { parkId, siteId, startDate, endDate, reason } = body;

    if (!parkId || !siteId || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    const blackoutId = uuid();
    await store.createBlackoutDate({
      id: blackoutId,
      park_id: parkId,
      site_id: siteId,
      start_date: startDate,
      end_date: endDate,
      reason: reason || 'Blocked by staff',
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ id: blackoutId }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] create blackout error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

/**
 * DELETE /api/admin/booking-rules/blackout-dates/:blackoutId
 * Delete a blackout period
 */
export async function deleteBlackout(req, { params }) {
  const staff = await ensureAuth(req);
  if (!staff) return new Response('Unauthorized', { status: 401 });

  const { blackoutId } = params;

  try {
    await store.deleteBlackoutDate(blackoutId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[booking-rules API] delete blackout error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
