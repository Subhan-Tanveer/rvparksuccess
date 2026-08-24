// Consolidated router for the operational admin features: booking-rules,
// calendar, ml-optimization, occupancy-forecasting, competitive-intelligence,
// multi-property, ota, parks (sites/staff-booking were folded into
// api/admin/dashboard.js instead — see the note near the bottom of this
// file). Dispatches on the `resource` query param so all of these live in
// one Vercel serverless function — Vercel's Hobby (free) plan caps a
// deployment at 12 functions, and each file directly under api/ counts as
// one, so these used to be separate files. The business logic below was
// lifted from the individual
// api/admin/{booking-rules,calendar,...}.js files that used to exist
// (recoverable at git commit e87d80a) — same behavior, just routed through
// one file (with a few auth/import fixes for files whose original imports
// no longer exist in api/_lib — see comments per resource). api/_lib/**,
// which all of this calls into, was never deleted and doesn't count
// toward the function limit.
import { randomUUID } from 'crypto';
import { requireSession } from '../_lib/auth.js';

// reservations-store.js registers a custom Postgres type parser for DATE
// columns (OID 1082) that returns them as plain 'YYYY-MM-DD' strings
// rather than JS Date objects — so check_in/check_out come back as
// strings already in the exact format callers below want, not Dates.
// Handles both shapes defensively (mirrors mapBlockedDate's pattern in
// reservations-store.js) in case that ever changes.
function toDateStr(value) {
  return value instanceof Date ? value.toISOString().split('T')[0] : value;
}
import {
  getPark,
  getSitesForPark,
  getReservationsForPark,
  getReservationsForParkInRange,
  getBlockedDatesForPark,
  createStaffReservation,
  moveReservation,
  cancelReservation,
  addBlockedDate,
  removeBlockedDate,
  getReservationById,
  getSite,
  getBookingRules,
  createBookingRule,
  updateBookingRule,
  deleteBookingRule,
  getBlackoutDates,
  getBlackoutDatesByDateRange,
  createBlackoutDate,
  deleteBlackoutDate,
  getReservationsBySiteInRange,
  getOccupancyForecastCache,
  saveOccupancyForecast,
  getSeasonalAnalysis,
  saveSeasonalAnalysis,
  getCompetitorsForPark,
  createPark,
  listParksForAdmin,
  setParkGhlCrmUrl,
  createAdminUser,
  listAdminUsers,
  removeAdminUser,
  applyDynamicPriceOverride,
  query as dbQuery,
} from '../_lib/reservations-store.js';
import {
  validateBooking,
  calculateBookingCost,
  enforceCancellationPolicy,
  checkRuleConflicts,
} from '../_lib/booking-rules-engine.js';
import {
  forecastOccupancy,
  detectSeason,
  getBookingPaceIndex,
  predictSeasonalPeak,
  analyzeOccupancyTrend,
  getCapacityUtilization,
  identifyUnderutilizedDates,
  getConfidenceForDate,
  detectAnomalies,
} from '../_lib/occupancy-forecaster.js';
import {
  getPriceComparison,
  suggestPriceAdjustment,
  getMarketTrends,
  identifyPricingOpportunities,
  addCompetitorForPark,
  removeCompetitorForPark,
  refreshCompetitorData,
} from '../_lib/competitor-intelligence.js';
import {
  getUserProperties,
  getConsolidatedMetrics,
  getPropertyComparison,
  bulkUpdateRates,
  bulkSendPromotion,
  bulkScheduleMaintenance,
  getPropertyHierarchy,
  getBrandingForProperty,
  applyBranding,
  getConsolidatedAlerts,
} from '../_lib/multi-property-manager.js';
import { AvailabilitySyncEngine } from '../_lib/availability-sync.js';
import { OTAManager } from '../_lib/ota-manager.js';
import * as store from '../_lib/reservations-store.js';
import RateOptimizer, { serializeModel, deserializeModel } from '../_lib/ml-rate-optimizer.js';
import { generateNarrative } from '../_lib/ai-insights.js';
import { notifyWaitlistOfOpening } from '../_lib/waitlist-matcher.js';
import { getGoogleAuthUrl, exchangeCodeForTokens, getGoogleAccountEmail, syncReservationToGoogleCalendar, deleteReservationFromGoogleCalendar } from '../_lib/google-calendar.js';
import { del as deleteBlob } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  const { resource } = req.query;

  switch (resource) {
    case 'booking-rules':
      return bookingRulesHandler(req, res);
    case 'calendar':
      return calendarHandler(req, res);
    case 'ml-optimization':
      return mlOptimizationHandler(req, res);
    case 'occupancy-forecasting':
      return occupancyForecastingHandler(req, res);
    case 'competitive-intelligence':
      return competitiveIntelligenceHandler(req, res);
    case 'multi-property':
      return multiPropertyHandler(req, res);
    case 'ota':
      return otaHandler(req, res);
    case 'parks':
      return parksHandler(req, res);
    case 'admin-users':
      return adminUsersHandler(req, res);
    case 'ai-insight':
      return aiInsightHandler(req, res);
    case 'park-media':
      return parkMediaHandler(req, res);
    case 'expenses':
      return expensesHandler(req, res);
    case 'availability-blockers':
      return availabilityBlockersHandler(req, res);
    case 'google-calendar':
      return googleCalendarHandler(req, res);
    default:
      return res.status(400).json({ error: 'Unknown or missing resource parameter' });
  }
}

/* ================================================================== */
/* booking-rules — lifted from api/admin/booking-rules.js. That file    */
/* was written for a different (Next.js-style Request/Response, named   */
/* GET/POST/PATCH/DELETE exports with dynamic route params) runtime     */
/* than this app actually uses (Vercel (req,res) functions) and its     */
/* `ensureAuth`/`getStore` imports no longer exist — rewritten below to */
/* match this app's (req,res) + requireSession + query-param dispatch   */
/* pattern, calling the same api/_lib/booking-rules-engine.js /         */
/* reservations-store.js functions the original intended to use.       */
/* ================================================================== */

const bookingRuleStore = {
  getBookingRules,
  getBlackoutDates,
  getReservationsBySiteInRange,
  getBlackoutDatesByDateRange,
  getSite,
};

async function bookingRulesHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { action } = req.query;
  // ruleId/blackoutId can arrive as a query param or in the body (PATCH/DELETE
  // send them in the body since these aren't real dynamic sub-routes).
  const ruleId = req.query.ruleId || req.body?.ruleId;
  const blackoutId = req.query.blackoutId || req.body?.blackoutId;

  try {
    // GET ?action=rules&parkId=&siteId= — list rules (optionally by-site)
    if (req.method === 'GET' && (!action || action === 'rules')) {
      const { parkId, siteId } = req.query;
      if (!parkId) return res.status(400).json({ error: 'parkId is required' });
      const rules = await getBookingRules(parkId, siteId || null);
      return res.status(200).json(rules);
    }

    // GET ?action=blackout-dates&parkId=&siteId= — list blackout dates
    if (req.method === 'GET' && action === 'blackout-dates') {
      const { parkId, siteId } = req.query;
      if (!parkId) return res.status(400).json({ error: 'parkId is required' });
      const blackouts = await getBlackoutDates(parkId, siteId || null);
      return res.status(200).json(blackouts);
    }

    // POST ?action=validate — test if a booking would be allowed
    if (req.method === 'POST' && action === 'validate') {
      const { parkId, siteId, checkIn, checkOut, guestCount = 1 } = req.body || {};
      if (!parkId || !siteId || !checkIn || !checkOut) return res.status(400).json({ error: 'Missing required fields' });

      const result = await validateBooking({ checkIn, checkOut, siteId, parkId, guestCount }, bookingRuleStore);
      const site = await getSite(siteId);
      const costData = await calculateBookingCost({ checkIn, checkOut }, site, bookingRuleStore, parkId);

      return res.status(200).json({ ...result, cost: costData });
    }

    // POST ?action=cancellation-test — test cancellation policy
    if (req.method === 'POST' && action === 'cancellation-test') {
      const { parkId, reservationId, cancellationDate } = req.body || {};
      if (!parkId || !reservationId) return res.status(400).json({ error: 'Missing required fields' });

      const reservation = await getReservationById(reservationId);
      if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

      const cancelDate = new Date(cancellationDate || new Date());
      const result = await enforceCancellationPolicy(reservation, cancelDate, bookingRuleStore);
      return res.status(200).json(result);
    }

    // POST ?action=blackout-dates — create a blackout period
    if (req.method === 'POST' && action === 'blackout-dates') {
      const { parkId, siteId, startDate, endDate, reason } = req.body || {};
      if (!parkId || !siteId || !startDate || !endDate) return res.status(400).json({ error: 'Missing required fields' });

      const newBlackoutId = randomUUID();
      await createBlackoutDate({
        id: newBlackoutId,
        park_id: parkId,
        site_id: siteId,
        start_date: startDate,
        end_date: endDate,
        reason: reason || 'Blocked by staff',
        created_at: new Date().toISOString(),
      });

      return res.status(201).json({ id: newBlackoutId });
    }

    // DELETE ?action=blackout-dates (body: {blackoutId}) — delete a blackout period
    if (req.method === 'DELETE' && action === 'blackout-dates') {
      if (!blackoutId) return res.status(400).json({ error: 'blackoutId is required' });
      await deleteBlackoutDate(blackoutId);
      return res.status(200).json({ success: true });
    }

    // POST ?action=rules (no ruleId in body) — create a new rule
    if (req.method === 'POST' && (!action || action === 'rules') && !ruleId) {
      const { parkId, siteId, ruleType, ruleConfig, isActive = true, priority = 0 } = req.body || {};
      if (!parkId || !ruleType || !ruleConfig) return res.status(400).json({ error: 'Missing required fields' });

      const existingRules = await getBookingRules(parkId, siteId);
      const newRule = { rule_type: ruleType, rule_config_json: JSON.stringify(ruleConfig) };
      const { hasConflict, conflicts } = checkRuleConflicts(newRule, existingRules);
      if (hasConflict) return res.status(400).json({ error: 'Rule conflicts detected', conflicts });

      const newRuleId = randomUUID();
      await createBookingRule({
        id: newRuleId,
        park_id: parkId,
        site_id: siteId || null,
        rule_type: ruleType,
        rule_config_json: JSON.stringify(ruleConfig),
        is_active: isActive,
        priority,
        created_at: new Date().toISOString(),
      });

      return res.status(201).json({ id: newRuleId });
    }

    // PATCH ?action=rules (body: {ruleId, ...}) — update an existing rule
    if (req.method === 'PATCH') {
      if (!ruleId) return res.status(400).json({ error: 'ruleId is required' });
      const { isActive, ruleConfig, priority } = req.body || {};
      await updateBookingRule(ruleId, {
        is_active: isActive,
        rule_config_json: ruleConfig ? JSON.stringify(ruleConfig) : undefined,
        priority,
      });
      return res.status(200).json({ success: true });
    }

    // DELETE ?action=rules (body: {ruleId}) — delete a rule
    if (req.method === 'DELETE' && (!action || action === 'rules')) {
      if (!ruleId) return res.status(400).json({ error: 'ruleId is required' });
      await deleteBookingRule(ruleId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown booking-rules request' });
  } catch (err) {
    console.error('[booking-rules] error:', err);
    return res.status(500).json({ error: err.message });
  }
}

/* ================================================================== */
/* calendar — lifted from api/admin/calendar.js. Dropped two imports    */
/* (`blockDates`, `unblockDate`) that don't exist in reservations-      */
/* store.js and were unused in the original file's body anyway          */
/* (it actually called addBlockedDate/removeBlockedDate). Otherwise     */
/* unchanged.                                                            */
/* ================================================================== */

async function calendarHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method === 'GET') {
    try {
      const { parkId, month } = req.query;
      if (!parkId || parkId !== session.parkId) return res.status(403).json({ error: 'Unauthorized' });

      const park = await getPark(parkId);
      if (!park) return res.status(404).json({ error: 'Park not found' });

      const [yearStr, monthStr] = month.split('-');
      const startDate = new Date(`${yearStr}-${monthStr}-01`);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);

      // Release any checkout the guest abandoned more than 20 minutes ago —
      // otherwise a still-'pending' hold sits on the calendar showing as
      // occupied indefinitely, since nothing else about *viewing* the
      // calendar would trigger this cleanup (only an availability search or
      // a booking attempt on that exact site did, until now).
      await dbQuery(
        `UPDATE reservations SET status = 'canceled' WHERE park_id = $1 AND status = 'pending' AND hold_expires_at < now()`,
        [parkId]
      );

      const sites = await getSitesForPark(parkId);
      // Canceled reservations (abandoned checkouts, superseded retries, staff
      // cancellations) still exist in the database as a record, but they're
      // not real occupancy — the calendar's cell lookup has no status
      // filter of its own, so sending these through made a canceled booking
      // indistinguishable from a real one and let it block/occupy a date
      // (sometimes even hiding the actual confirmed reservation for that
      // same site/date, depending on array order).
      const reservations = (await getReservationsForParkInRange(parkId, startDate, endDate))
        .filter((r) => r.status !== 'canceled');
      const blockedDates = await getBlockedDatesForPark(parkId, startDate, endDate);

      const formattedReservations = reservations.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        guestName: r.guestName,
        guestPhone: r.guestPhone || null,
        guestEmail: r.guestEmail || null,
        checkInDate: toDateStr(r.checkIn),
        checkOutDate: toDateStr(r.checkOut),
        totalCents: r.totalCents,
        status: r.status,
      }));

      const formattedBlockedDates = blockedDates.map((b) => ({
        siteId: b.siteId,
        date: b.date.toISOString().split('T')[0],
        reason: b.reason || null,
      }));

      const formattedSites = sites.map((s) => ({
        id: s.id, name: s.name, type: s.type, capacity: s.capacity, nightlyRateCents: s.nightlyRateCents,
      }));

      return res.status(200).json({ sites: formattedSites, reservations: formattedReservations, blockedDates: formattedBlockedDates });
    } catch (err) {
      console.error('Calendar GET error:', err);
      return res.status(500).json({ error: 'Failed to load calendar data' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { action, siteId, guestName, guestPhone, guestEmail, checkInDate, checkOutDate, paymentMethod, reason } = req.body;
      if (!action) return res.status(400).json({ error: 'Missing action' });

      if (action === 'create-reservation') {
        if (!siteId || !guestName || !checkInDate || !checkOutDate) return res.status(400).json({ error: 'Missing required fields' });
        if (new Date(checkOutDate) <= new Date(checkInDate)) return res.status(400).json({ error: 'Invalid dates' });

        // createStaffReservation (not the old createReservation, now
        // removed) is what actually checks the site is still free for
        // these dates before booking it, locks the site during that check
        // so two staff clicking the same open day at once can't both win,
        // and prices the stay correctly (seasonal rates, tax) instead of
        // a flat nightly rate with tax hardcoded to 0.
        const reservation = await createStaffReservation({
          parkId: session.parkId, siteId, checkIn: checkInDate, checkOut: checkOutDate,
          guestName, guestPhone: guestPhone || null, guestEmail: guestEmail || null,
          paymentMethod: paymentMethod || 'cash',
        });

        if (reservation.status === 'confirmed' || reservation.status === 'confirmed-deposit') {
          const park = await getPark(session.parkId);
          if (park) {
            syncReservationToGoogleCalendar(park, reservation).catch((err) =>
              console.error('Google Calendar sync failed:', err.message)
            );
          }
        }

        return res.status(201).json({
          success: true,
          reservation: {
            id: reservation.id, siteId: reservation.siteId, guestName: reservation.guestName,
            checkInDate: reservation.checkIn,
            checkOutDate: reservation.checkOut,
            totalCents: reservation.totalCents,
          },
        });
      }

      if (action === 'block-dates') {
        if (!siteId || !checkInDate || !checkOutDate) return res.status(400).json({ error: 'Missing required fields' });
        const checkIn = new Date(checkInDate + 'T00:00:00Z');
        const checkOut = new Date(checkOutDate + 'T00:00:00Z');
        if (checkOut < checkIn) return res.status(400).json({ error: 'Invalid dates' });

        const current = new Date(checkIn);
        while (current < checkOut) {
          await addBlockedDate({ parkId: session.parkId, siteId, date: current, reason: reason || 'Blocked by staff' });
          current.setDate(current.getDate() + 1);
        }
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Calendar POST error:', err);
      // Surface the real reason (e.g. "Site is no longer available for
      // those dates" from createStaffReservation) instead of a generic
      // failure message — staff need to know WHY a click-to-book failed,
      // same as everywhere else booking errors are shown in this app.
      return res.status(400).json({ error: err.message || 'Could not process request' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { action, reservationId, newSiteId, newCheckInDate, newCheckOutDate } = req.body;

      if (action === 'move-reservation') {
        if (!reservationId || !newSiteId || !newCheckInDate || !newCheckOutDate) return res.status(400).json({ error: 'Missing required fields' });

        const reservation = await getReservationById(reservationId);
        if (!reservation || reservation.parkId !== session.parkId) return res.status(404).json({ error: 'Reservation not found' });

        const checkIn = new Date(newCheckInDate + 'T00:00:00Z');
        const checkOut = new Date(newCheckOutDate + 'T00:00:00Z');
        if (checkOut <= checkIn) return res.status(400).json({ error: 'Invalid dates' });

        const updated = await moveReservation(reservationId, newSiteId, checkIn, checkOut);
        if (updated.status === 'confirmed' || updated.status === 'confirmed-deposit') {
          const park = await getPark(session.parkId);
          if (park) {
            syncReservationToGoogleCalendar(park, updated).catch((err) =>
              console.error('Google Calendar sync failed:', err.message)
            );
          }
        }
        return res.status(200).json({
          success: true,
          reservation: {
            id: updated.id, siteId: updated.siteId,
            checkInDate: toDateStr(updated.checkIn),
            checkOutDate: toDateStr(updated.checkOut),
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
        if (!siteId || !date) return res.status(400).json({ error: 'Missing required fields' });
        await removeBlockedDate(session.parkId, siteId, new Date(date + 'T00:00:00Z'));
        return res.status(200).json({ success: true });
      }

      if (action === 'cancel-reservation') {
        if (!reservationId) return res.status(400).json({ error: 'Missing reservation ID' });
        const reservation = await getReservationById(reservationId);
        if (!reservation || reservation.parkId !== session.parkId) return res.status(404).json({ error: 'Reservation not found' });
        await cancelReservation(reservationId);
        // Best-effort — a notify failure should never surface as a
        // failed cancellation, the cancellation itself already succeeded.
        notifyWaitlistOfOpening(session.parkId).catch((err) => console.error('Waitlist notify error:', err.message));
        deleteReservationFromGoogleCalendar(session.parkId, reservation).catch((err) =>
          console.error('Google Calendar delete failed:', err.message)
        );
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

/* ================================================================== */
/* ml-optimization — lifted from api/admin/ml-optimization.js. Its      */
/* `authRequired` and `Store.query` imports no longer exist; swapped    */
/* for requireSession + the shared `query` export from reservations-    */
/* store.js. Path segments (/ml-optimization/train, etc.) became        */
/* ?action= query values (frontend updated to match). Business SQL/     */
/* RateOptimizer logic is unchanged.                                    */
/* ================================================================== */

async function mlOptimizationHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  // Frontend (ml-optimization-dashboard.js) sends this sub-selector as
  // `endpoint` (matching occupancy-forecasting's convention); accept
  // `action` too so either naming works.
  const action = req.query.endpoint || req.query.action;

  if (req.method === 'GET') {
    if (action === 'model-status') return mlModelStatus(req, res);
    if (action === 'rate-prediction') return mlRatePrediction(req, res);
    if (action === 'occupancy-forecast') return mlOccupancyForecast(req, res);
    if (action === 'elasticity') return mlElasticity(req, res);
    if (action === 'seasonal-rates') return mlSeasonalRates(req, res);
    if (action === 'performance') return mlPerformance(req, res);
  }

  if (req.method === 'POST') {
    if (action === 'train') return mlTrain(req, res);
    if (action === 'apply-suggestion') return mlApplySuggestion(req, res);
  }

  return res.status(404).json({ error: 'Not found' });
}

async function mlModelStatus(req, res) {
  const { parkId, siteId } = req.query;
  if (!parkId || !siteId) return res.status(400).json({ error: 'parkId and siteId required' });

  try {
    const model_record = await dbQuery(
      `SELECT model_json, accuracy_mae, last_trained, data_points_count
       FROM ml_models WHERE site_id = $1 AND park_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, parkId]
    );

    if (!model_record.rows.length) {
      return res.status(200).json({
        status: 'untrained', message: 'No model trained yet', data_points: 0,
        accuracy_mae: null, last_trained: null, next_step: 'Train model with historical data',
      });
    }

    const record = model_record.rows[0];
    const model = deserializeModel(JSON.parse(record.model_json));

    return res.status(200).json({
      status: model.model_health.sufficient_data ? 'ready' : 'training',
      message: model.model_health.sufficient_data ? 'Model ready' : 'Insufficient historical data',
      data_points: record.data_points_count,
      accuracy_mae: record.accuracy_mae ? parseFloat(record.accuracy_mae) : null,
      last_trained: record.last_trained,
      model_health: model.model_health,
      confidence: model.model_health.sufficient_data ? 0.8 : 0.3,
    });
  } catch (err) {
    console.error('Model status error:', err);
    return res.status(500).json({ error: 'Failed to fetch model status' });
  }
}

async function mlRatePrediction(req, res) {
  const { siteId, date } = req.query;
  if (!siteId || !date) return res.status(400).json({ error: 'siteId and date required' });

  try {
    const site_result = await dbQuery(
      `SELECT p.id as park_id, s.nightly_rate_cents, p.min_price_cents, p.max_price_cents
       FROM sites s JOIN parks p ON s.park_id = p.id WHERE s.id = $1`,
      [siteId]
    );
    if (!site_result.rows.length) return res.status(404).json({ error: 'Site not found' });

    const site = site_result.rows[0];
    const baseRate = site.nightly_rate_cents / 100;
    const minRate = (site.min_price_cents || 2000) / 100;
    const maxRate = (site.max_price_cents || 50000) / 100;

    const model_result = await dbQuery(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [siteId, site.park_id]
    );
    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;

    const optimization = RateOptimizer.optimizeRate(date, model, baseRate, minRate, maxRate, 'revenue');

    return res.status(200).json({
      date,
      suggested_rate: optimization.rate,
      current_rate: baseRate,
      rate_change_percent: ((optimization.rate - baseRate) / baseRate * 100).toFixed(1),
      predicted_occupancy: (optimization.occupancy * 100).toFixed(1),
      revenue_estimate: optimization.revenue.toFixed(2),
      confidence: (optimization.confidence * 100).toFixed(0),
      method: 'elastic-seasonal-blend',
    });
  } catch (err) {
    console.error('Rate prediction error:', err);
    return res.status(500).json({ error: 'Failed to predict rate' });
  }
}

async function mlOccupancyForecast(req, res) {
  const { siteId, date, rate } = req.query;
  if (!siteId || !date) return res.status(400).json({ error: 'siteId and date required' });

  try {
    const site_result = await dbQuery(`SELECT park_id FROM sites WHERE id = $1`, [siteId]);
    if (!site_result.rows.length) return res.status(404).json({ error: 'Site not found' });
    const park_id = site_result.rows[0].park_id;

    const model_result = await dbQuery(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [siteId, park_id]
    );
    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;
    const test_rate = rate ? parseFloat(rate) : 150;

    const pred = RateOptimizer.predictOccupancy(test_rate, date, model);

    return res.status(200).json({
      date, rate: test_rate,
      predicted_occupancy_percent: (pred.occupancy * 100).toFixed(1),
      confidence_percent: (pred.confidence * 100).toFixed(0),
      prediction_method: pred.method,
      expected_revenue: (test_rate * pred.occupancy).toFixed(2),
    });
  } catch (err) {
    console.error('Occupancy forecast error:', err);
    return res.status(500).json({ error: 'Failed to forecast occupancy' });
  }
}

async function mlElasticity(req, res) {
  const { siteId } = req.query;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });

  try {
    const site_result = await dbQuery(`SELECT park_id FROM sites WHERE id = $1`, [siteId]);
    if (!site_result.rows.length) return res.status(404).json({ error: 'Site not found' });
    const park_id = site_result.rows[0].park_id;

    const model_result = await dbQuery(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [siteId, park_id]
    );
    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;
    const analysis = RateOptimizer.analyzeElasticity(model);

    return res.status(200).json({
      elasticity_coefficient: analysis.elasticity.toFixed(2),
      interpretation: analysis.interpretation,
      recommendation: analysis.recommendation,
      explanation: 'Elasticity measures price sensitivity: negative values mean demand decreases with price increases. Closer to -1 means more sensitive; closer to 0 means less sensitive.',
    });
  } catch (err) {
    console.error('Elasticity analysis error:', err);
    return res.status(500).json({ error: 'Failed to analyze elasticity' });
  }
}

async function mlSeasonalRates(req, res) {
  const { siteId, month } = req.query;
  if (!siteId || !month) return res.status(400).json({ error: 'siteId and month required' });

  try {
    const site_result = await dbQuery(`SELECT park_id, nightly_rate_cents FROM sites WHERE id = $1`, [siteId]);
    if (!site_result.rows.length) return res.status(404).json({ error: 'Site not found' });

    const { park_id, nightly_rate_cents } = site_result.rows[0];
    const baseRate = nightly_rate_cents / 100;

    const park_result = await dbQuery(`SELECT min_price_cents, max_price_cents FROM parks WHERE id = $1`, [park_id]);
    const minRate = (park_result.rows[0]?.min_price_cents || 2000) / 100;
    const maxRate = (park_result.rows[0]?.max_price_cents || 50000) / 100;

    const model_result = await dbQuery(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [siteId, park_id]
    );
    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;

    const monthNum = parseInt(month);
    const year = new Date().getFullYear();
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split('T')[0];

    const suggestions = RateOptimizer.suggestSeasonalRates(siteId, startDate, endDate, model, baseRate, minRate, maxRate);

    const rates = suggestions.map((s) => s.suggested_rate);
    const avg_rate = rates.reduce((a, b) => a + b) / rates.length;
    const occupancies = suggestions.map((s) => s.predicted_occupancy);
    const avg_occupancy = occupancies.reduce((a, b) => a + b) / occupancies.length;

    return res.status(200).json({
      month: monthNum, suggestions,
      summary: {
        average_suggested_rate: avg_rate.toFixed(2),
        average_predicted_occupancy: avg_occupancy.toFixed(1),
        current_base_rate: baseRate.toFixed(2),
        rate_range: [Math.min(...rates), Math.max(...rates)],
      },
    });
  } catch (err) {
    console.error('Seasonal rates error:', err);
    return res.status(500).json({ error: 'Failed to generate seasonal rates' });
  }
}

async function mlPerformance(req, res) {
  const { siteId, days = 30 } = req.query;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });

  try {
    const site_result = await dbQuery(`SELECT park_id FROM sites WHERE id = $1`, [siteId]);
    if (!site_result.rows.length) return res.status(404).json({ error: 'Site not found' });
    const park_id = site_result.rows[0].park_id;

    const performance = await dbQuery(
      `SELECT date_of_stay, ai_suggested_rate, set_rate, actual_occupancy, actual_revenue_cents, accuracy_error
       FROM rate_performance
       WHERE site_id = $1 AND park_id = $2 AND date_of_stay >= NOW() - INTERVAL '${parseInt(days, 10)} days'
       ORDER BY date_of_stay DESC`,
      [siteId, park_id]
    );

    if (!performance.rows.length) {
      return res.status(200).json({
        period_days: parseInt(days), accuracy_sample_size: 0, mean_accuracy_error: null,
        ai_recommendations_followed: 0, avg_revenue_per_night: 0, status: 'insufficient_data',
      });
    }

    const records = performance.rows;
    const errors = records.map((r) => Math.abs(r.accuracy_error || 0));
    const mean_error = errors.reduce((a, b) => a + b) / errors.length;
    const followed = records.filter((r) => r.set_rate === r.ai_suggested_rate).length;
    const revenues = records.map((r) => (r.actual_revenue_cents || 0) / 100);
    const avg_revenue = revenues.reduce((a, b) => a + b) / revenues.length;

    return res.status(200).json({
      period_days: parseInt(days),
      accuracy_sample_size: records.length,
      mean_accuracy_error_percent: mean_error.toFixed(1),
      median_accuracy_error: (errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)] || 0).toFixed(1),
      ai_recommendations_followed: followed,
      adoption_rate_percent: ((followed / records.length) * 100).toFixed(1),
      avg_revenue_per_night: avg_revenue.toFixed(2),
      status: mean_error < 10 ? 'accurate' : 'needs_improvement',
    });
  } catch (err) {
    console.error('Performance error:', err);
    return res.status(500).json({ error: 'Failed to fetch performance data' });
  }
}

async function mlTrain(req, res) {
  const { parkId, siteId } = req.body;
  if (!parkId || !siteId) return res.status(400).json({ error: 'parkId and siteId required' });

  try {
    // subtotal_cents is the TOTAL charged for the whole stay, not a nightly
    // rate — a 20-night stay and a 2-night stay at the same $45/night both
    // need to train the elasticity model on $45, not $900 vs $90. Dividing
    // by nights here (rather than in JS) keeps every consumer of rate_cents
    // downstream working with real per-night dollars.
    const reservations = await dbQuery(
      `SELECT check_in, check_out, nights, ROUND(subtotal_cents::numeric / GREATEST(nights, 1)) as rate_cents
       FROM reservations
       WHERE site_id = $1 AND park_id = $2 AND status IN ('confirmed', 'confirmed-deposit')
       AND check_in >= NOW() - INTERVAL '180 days'
       ORDER BY check_in`,
      [siteId, parkId]
    );

    const occupancy_data = await dbQuery(
      `SELECT date_of_stay as date, (actual_occupancy)::NUMERIC as occupancy
       FROM rate_performance WHERE site_id = $1 AND park_id = $2 ORDER BY date_of_stay DESC LIMIT 90`,
      [siteId, parkId]
    );

    // The model's occupancy proxy (booked-sites / base_sites) needs the
    // park's real site count — a hardcoded assumption compresses a 1-site
    // park's real 100%-when-booked occupancy down to a token amount and
    // erases any variance the model could otherwise learn from.
    const site_count_result = await dbQuery(`SELECT COUNT(*)::int as count FROM sites WHERE park_id = $1`, [parkId]);
    const siteCount = site_count_result.rows[0]?.count || 1;

    const reserv_list = reservations.rows || [];
    const occ_list = (occupancy_data.rows || []).map((r) => ({ date: r.date, occupancy: parseFloat(r.occupancy) }));

    if (reserv_list.length < 3) return res.status(400).json({ error: 'Insufficient historical data (need at least 3 bookings)' });

    const model = RateOptimizer.trainModel(reserv_list, occ_list, siteCount);

    const model_id = `mlm_${Date.now()}`;
    await dbQuery(
      `INSERT INTO ml_models (id, site_id, park_id, model_version, model_json, accuracy_mae, last_trained, data_points_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [model_id, siteId, parkId, '1.0', JSON.stringify(serializeModel(model)), model.accuracy_mae, model.last_trained, model.data_points]
    );

    return res.status(200).json({
      status: 'success', model_id, data_points_used: model.data_points,
      accuracy_mae: model.accuracy_mae.toFixed(2), model_health: model.model_health,
      message: 'Model trained successfully',
    });
  } catch (err) {
    console.error('Training error:', err);
    return res.status(500).json({ error: 'Failed to train model' });
  }
}

async function mlApplySuggestion(req, res) {
  const { siteId, date, suggestedRate } = req.body;
  if (!siteId || !date || suggestedRate === undefined) return res.status(400).json({ error: 'siteId, date, and suggestedRate required' });

  try {
    const site_result = await dbQuery(`SELECT park_id, nightly_rate_cents FROM sites WHERE id = $1`, [siteId]);
    if (!site_result.rows.length) return res.status(404).json({ error: 'Site not found' });

    const { park_id, nightly_rate_cents } = site_result.rows[0];
    const previous_rate = nightly_rate_cents;
    const applied_rate_cents = Math.round(suggestedRate * 100);

    const suggestion_id = `sugg_${Date.now()}`;
    await dbQuery(
      `INSERT INTO rate_suggestions (id, site_id, park_id, date, suggested_rate, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [suggestion_id, siteId, park_id, date, suggestedRate, 0.8]
    );

    // Actually change what a guest pays for that date — logging the
    // suggestion above without this would make "Apply" cosmetic-only,
    // same bug already fixed once for Pricing Intelligence's Apply button.
    await applyDynamicPriceOverride(siteId, park_id, date, applied_rate_cents);

    return res.status(200).json({
      status: 'success', suggestion_id,
      previous_rate: (previous_rate / 100).toFixed(2),
      applied_rate: suggestedRate.toFixed(2),
      change_percent: (((applied_rate_cents - previous_rate) / previous_rate) * 100).toFixed(1),
      message: 'Rate applied',
    });
  } catch (err) {
    console.error('Apply suggestion error:', err);
    return res.status(500).json({ error: 'Failed to apply suggestion' });
  }
}

/* ================================================================== */
/* occupancy-forecasting — lifted from api/admin/occupancy-forecasting.js */
/* (unchanged logic; already used ?endpoint= query dispatch)            */
/* ================================================================== */

const OCC_CACHE_HOURS = 24;

async function occupancyForecastingHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { method } = req;
  const { endpoint = 'forecast', parkId = session.parkId, days = '90' } = req.query;

  try {
    const park = await getPark(parkId);
    if (!park) return res.status(404).json({ error: 'Park not found' });
    if (session.parkId !== parkId) return res.status(403).json({ error: 'Access denied' });

    if (method === 'GET') return occGet(res, endpoint, req.query, park);
    if (method === 'POST') {
      if (endpoint === 'refresh') return occRefresh(res, park);
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Occupancy forecasting error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function occGet(res, endpoint, query, park) {
  // `park` here is already resolved from the caller's correctly-defaulted
  // parkId (falls back to session.parkId when the request doesn't specify
  // one) — re-reading `parkId` from the raw query threw that default away,
  // since none of this dashboard's fetch() calls ever send `?parkId=`. The
  // result was every occ* helper getting `parkId=undefined`, which made
  // getSitesForPark(undefined) return zero sites, which made every widget
  // hit its "no sites configured" fallback regardless of how much real
  // booking data existed. Use park.id (guaranteed correct) everywhere.
  const { days = '90', year = '2026', date, siteId } = query;
  const parkId = park.id;

  switch (endpoint) {
    case 'forecast': return occForecast(res, parkId, parseInt(days, 10));
    case 'seasonal-calendar': return occSeasonalCalendar(res, parkId, parseInt(year, 10));
    case 'booking-pace': return occBookingPace(res, park.id, siteId, date);
    case 'trend': return occTrend(res, parkId, parseInt(days, 10));
    case 'underutilized': return occUnderutilized(res, parkId);
    case 'confidence': return occConfidence(res, parkId, date);
    case 'anomalies': return occAnomalies(res, parkId);
    case 'peak-prediction': return occPeakPrediction(res, parkId);
    case 'capacity-utilization': return occCapacityUtil(res, parkId);
    case 'staffing-recommendations': return occStaffingRecommendations(res, parkId);
    default: return res.status(400).json({ error: 'Unknown endpoint' });
  }
}

function occIsCacheValid(createdAt, hoursValid) {
  const created = new Date(createdAt);
  const now = new Date();
  return (now - created) / (1000 * 60 * 60) < hoursValid;
}

function occHasYearChanged(lastUpdate) {
  return new Date(lastUpdate).getFullYear() !== new Date().getFullYear();
}

async function occForecast(res, parkId, days) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ forecast: [], warning: 'No sites configured for this park', cachedAt: null });

    const cached = await getOccupancyForecastCache(parkId);
    if (cached && occIsCacheValid(cached.createdAt, OCC_CACHE_HOURS)) {
      return res.json({ forecast: cached.forecastData || [], cachedAt: cached.createdAt, cacheValidFor: OCC_CACHE_HOURS });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      parkId, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, Math.min(days, 90));
    await saveOccupancyForecast(parkId, forecast);

    return res.json({ forecast, cachedAt: new Date().toISOString(), cacheValidFor: OCC_CACHE_HOURS });
  } catch (error) {
    console.error('Forecast error:', error);
    return res.status(500).json({ error: 'Could not generate forecast' });
  }
}

async function occSeasonalCalendar(res, parkId, year) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ calendar: [] });

    const cached = await getSeasonalAnalysis(parkId);
    if (cached && !occHasYearChanged(cached.updatedAt)) {
      return res.json({ calendar: cached.calendar || [], updatedAt: cached.updatedAt });
    }

    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    const reservations = await getReservationsForParkInRange(parkId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);

    const calendar = [];
    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const monthDays = [];

      for (let day = 1; day <= monthEnd.getDate(); day++) {
        const checkDate = new Date(year, month, day);
        const dateStr = checkDate.toISOString().split('T')[0];

        const bookedSites = new Set();
        for (const r of reservations) {
          const checkIn = new Date(r.checkIn);
          const checkOut = new Date(r.checkOut);
          if (checkIn <= checkDate && checkOut > checkDate && (r.status === 'confirmed' || r.status === 'confirmed-deposit')) bookedSites.add(r.siteId);
        }

        const occupancy = Math.round((bookedSites.size / totalSites) * 100);
        monthDays.push({ date: dateStr, day, occupancy, season: detectSeason(checkDate), isWeekend: checkDate.getDay() === 0 || checkDate.getDay() === 6 });
      }

      const monthOccupancy = Math.round(monthDays.reduce((sum, d) => sum + d.occupancy, 0) / monthDays.length);
      calendar.push({ month: month + 1, monthName: monthStart.toLocaleDateString('en-US', { month: 'long' }), year, averageOccupancy: monthOccupancy, season: detectSeason(monthStart), days: monthDays });
    }

    await saveSeasonalAnalysis(parkId, calendar);
    return res.json({ calendar, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Seasonal calendar error:', error);
    return res.status(500).json({ error: 'Could not generate seasonal calendar' });
  }
}

async function occBookingPace(res, parkId, siteId, targetDate) {
  try {
    // The dashboard's overview widget calls this with no siteId/date at all
    // (a park-wide pace check), so both are optional rather than required —
    // default the date to 30 days out, matching how far ahead "pace"
    // normally gets checked.
    const resolvedDate = targetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const allReservations = await getReservationsForPark(parkId);
    const reservations = siteId ? allReservations.filter((r) => r.siteId === siteId) : allReservations;
    const pace = getBookingPaceIndex(reservations, resolvedDate);
    return res.json({
      siteId: siteId || null, targetDate: resolvedDate, bookingPaceIndex: pace,
      interpretation: pace >= 120 ? 'Faster than normal pace' : pace >= 90 ? 'Normal pace' : pace >= 70 ? 'Slower than normal pace' : 'Much slower than normal',
      expectedDaysBooked: Math.round(40 * (pace / 100)),
    });
  } catch (error) {
    console.error('Booking pace error:', error);
    return res.status(500).json({ error: 'Could not calculate booking pace' });
  }
}

async function occTrend(res, parkId, daysToAnalyze) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ trend: 'insufficient-data' });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToAnalyze);
    const reservations = await getReservationsForParkInRange(parkId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);

    return res.json(analyzeOccupancyTrend(reservations, totalSites, daysToAnalyze));
  } catch (error) {
    console.error('Trend analysis error:', error);
    return res.status(500).json({ error: 'Could not analyze trend' });
  }
}

async function occUnderutilized(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ underutilized: [] });

    // identifyUnderutilizedDates forecasts the NEXT 90 days, so the query
    // needs to reach that far forward too — same bug as occCapacityUtil:
    // fetching only up through today made every future booking invisible.
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
    const reservations = await getReservationsForParkInRange(
      parkId, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const underutilized = identifyUnderutilizedDates(reservations, totalSites, 90, 40);
    return res.json({ underutilized, count: underutilized.length, totalPotentialRevenueLoss: underutilized.reduce((sum, u) => sum + u.potentialRevenueLoss, 0) });
  } catch (error) {
    console.error('Underutilized dates error:', error);
    return res.status(500).json({ error: 'Could not identify underutilized dates' });
  }
}

async function occConfidence(res, parkId, date) {
  try {
    if (!date) return res.status(400).json({ error: 'Missing date parameter' });
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ confidence: 0 });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);
    const reservations = await getReservationsForParkInRange(
      parkId, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, 90);
    return res.json(getConfidenceForDate(forecast, date));
  } catch (error) {
    console.error('Confidence error:', error);
    return res.status(500).json({ error: 'Could not calculate confidence' });
  }
}

async function occAnomalies(res, parkId) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const reservations = await getReservationsForParkInRange(parkId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);

    const anomalies = detectAnomalies(reservations, 90);
    return res.json({ anomalies, count: anomalies.length });
  } catch (error) {
    console.error('Anomalies error:', error);
    return res.status(500).json({ error: 'Could not detect anomalies' });
  }
}

async function occPeakPrediction(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ peak: null });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);
    const reservations = await getReservationsForParkInRange(
      parkId, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    return res.json({ peak: predictSeasonalPeak(reservations, totalSites) });
  } catch (error) {
    console.error('Peak prediction error:', error);
    return res.status(500).json({ error: 'Could not predict peak' });
  }
}

async function occCapacityUtil(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ utilization: null });

    // getCapacityUtilization analyzes the NEXT 30 days (today -> today+30),
    // but this only fetched reservations up through today — every future
    // booking (which is where almost all real activity lives) was
    // invisible to it, so utilization was computed against an
    // almost-empty reservation set regardless of how full the park
    // actually is. Extend the query forward to cover what's actually
    // being analyzed.
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);
    const reservations = await getReservationsForParkInRange(
      parkId, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    return res.json(getCapacityUtilization(reservations, totalSites, 30));
  } catch (error) {
    console.error('Capacity utilization error:', error);
    return res.status(500).json({ error: 'Could not calculate capacity utilization' });
  }
}

async function occStaffingRecommendations(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ recommendations: [] });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);
    const reservations = await getReservationsForParkInRange(
      parkId, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, 90);
    const recommendations = [];
    let currentGroup = null;

    for (const day of forecast) {
      const level = day.forecastOccupancy >= 80 ? 'high' : day.forecastOccupancy >= 50 ? 'medium' : 'low';
      const recText = level === 'high' ? 'Full staff - expected high occupancy' : level === 'medium' ? 'Standard staffing level' : 'Minimal staffing - low occupancy expected';
      const adjustment = level === 'high' ? '+2 seasonal staff' : level === 'medium' ? 'No change' : '-1 to minimal staff';

      if (!currentGroup || currentGroup.level !== level) {
        if (currentGroup) recommendations.push(currentGroup);
        currentGroup = { level, startDate: day.date, endDate: day.date, occupancy: day.forecastOccupancy, recommendation: recText, staffAdjustment: adjustment };
      } else {
        currentGroup.endDate = day.date;
        currentGroup.occupancy = (currentGroup.occupancy + day.forecastOccupancy) / 2;
      }
    }
    if (currentGroup) recommendations.push(currentGroup);

    return res.json({ recommendations: recommendations.slice(0, 12) });
  } catch (error) {
    console.error('Staffing recommendations error:', error);
    return res.status(500).json({ error: 'Could not generate staffing recommendations' });
  }
}

async function occRefresh(res, park) {
  try {
    const sites = await getSitesForPark(park.id);
    const totalSites = sites.length;
    if (totalSites === 0) return res.json({ success: false, message: 'No sites configured' });

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);
    const reservations = await getReservationsForParkInRange(
      park.id, startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, 90);
    await saveOccupancyForecast(park.id, forecast);

    return res.json({ success: true, message: 'Forecast refreshed', forecastedDays: forecast.length, lastRefreshed: new Date().toISOString() });
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({ success: false, error: 'Could not refresh forecast' });
  }
}

/* ================================================================== */
/* competitive-intelligence — lifted from                               */
/* api/admin/competitive-intelligence.js (unchanged logic)              */
/* ================================================================== */

async function competitiveIntelligenceHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const park = await getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });

  if (req.method === 'GET') {
    const { action } = req.query;
    try {
      if (action === 'competitors') {
        const competitors = await getCompetitorsForPark(session.parkId);
        return res.status(200).json({ competitors });
      }

      if (action === 'market-rates') {
        const { siteType } = req.query;
        if (!siteType) return res.status(400).json({ error: 'siteType parameter required (tent|rv|cabin)' });
        const comparison = await getPriceComparison(session.parkId, siteType);
        if (!comparison) return res.status(200).json({ message: 'No competitor data available yet', siteType });
        return res.status(200).json(comparison);
      }

      if (action === 'suggestions') {
        const sites = await getSitesForPark(session.parkId);
        const suggestions = [];
        for (const site of sites) {
          const suggestion = await suggestPriceAdjustment(session.parkId, site.id);
          if (suggestion) suggestions.push({ ...suggestion, site: { id: site.id, name: site.name, type: site.type } });
        }
        return res.status(200).json({ suggestions: suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore), generatedAt: new Date().toISOString() });
      }

      if (action === 'trends') {
        const { days = '90' } = req.query;
        const daysParsed = Math.max(7, Math.min(365, parseInt(days, 10)));
        const trends = await getMarketTrends(session.parkId, daysParsed);
        if (!trends) return res.status(200).json({ message: 'No trend data available yet', requestedDays: daysParsed });
        return res.status(200).json(trends);
      }

      if (action === 'positioning') {
        const competitors = await getCompetitorsForPark(session.parkId);
        if (competitors.length === 0) return res.status(200).json({ message: 'No competitors tracked yet', competitorCount: 0 });

        const sites = await getSitesForPark(session.parkId);
        const siteTypes = [...new Set(sites.map((s) => s.type))];
        const positioning = {};
        for (const siteType of siteTypes) positioning[siteType] = await getPriceComparison(session.parkId, siteType);

        return res.status(200).json({ positioning, competitorCount: competitors.length });
      }

      if (action === 'opportunities') {
        const opportunities = await identifyPricingOpportunities(session.parkId);
        return res.status(200).json({ opportunities, opportunityCount: opportunities.length, generatedAt: new Date().toISOString() });
      }

      if (action === 'dashboard-summary' || !action) {
        const competitors = await getCompetitorsForPark(session.parkId);
        const sites = await getSitesForPark(session.parkId);
        const siteTypes = [...new Set(sites.map((s) => s.type))];

        const [trends, opportunities] = await Promise.all([
          getMarketTrends(session.parkId, 90),
          identifyPricingOpportunities(session.parkId),
        ]);

        const positioningByType = {};
        for (const siteType of siteTypes) positioningByType[siteType] = await getPriceComparison(session.parkId, siteType);

        return res.status(200).json({
          summary: { competitorsTracked: competitors.length, sitesManaged: sites.length, opportunitiesIdentified: opportunities.length, marketTrendDays: 90 },
          positioning: positioningByType,
          opportunities: opportunities.slice(0, 5),
          trends: trends ? trends.trends.slice(-30) : [],
          lastUpdated: new Date().toISOString(),
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Competitive intelligence GET error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { action, ...payload } = req.body || {};
    try {
      if (action === 'add-competitor') {
        const { name, websiteUrl, location, address, googleMapsUrl, placeId, lat, lng } = payload;
        if (!name) return res.status(400).json({ error: 'Competitor name is required' });
        const competitor = await addCompetitorForPark(session.parkId, { name, websiteUrl, location, address, googleMapsUrl, placeId, lat, lng });
        return res.status(201).json({ competitor, message: 'Competitor added successfully' });
      }

      if (action === 'refresh') {
        const result = await refreshCompetitorData(session.parkId);
        return res.status(200).json({ message: 'Competitor data refreshed', ...result });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Competitive intelligence POST error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { competitorId } = req.body || {};
    try {
      if (!competitorId) return res.status(400).json({ error: 'Competitor ID required' });
      await removeCompetitorForPark(session.parkId, competitorId);
      return res.status(200).json({ message: 'Competitor removed successfully', competitorId });
    } catch (err) {
      console.error('Competitive intelligence DELETE error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/* ================================================================== */
/* multi-property — lifted from api/admin/multi-property.js. Its own    */
/* inner sub-routing already used a query param named `resource`, which */
/* collides with the outer resource=multi-property wrapper used here —  */
/* renamed the inner param to `view` (frontend updated to match).       */
/* ================================================================== */

async function multiPropertyHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const userId = session.parkId;
  const view = req.query.sub;

  try {
    if (req.method === 'GET' && (!view || view === 'portfolio')) {
      const properties = await getUserProperties(userId);
      return res.status(200).json({ properties, count: properties.length });
    }

    if (req.method === 'GET' && view === 'consolidated-metrics') {
      const days = parseInt(req.query.days || '30', 10);
      const metrics = await getConsolidatedMetrics(userId, days);
      return res.status(200).json(metrics);
    }

    if (req.method === 'GET' && view === 'property-comparison') {
      const sortBy = req.query.sortBy || 'revenue';
      const comparison = await getPropertyComparison(userId, sortBy);
      return res.status(200).json({ properties: comparison });
    }

    if (req.method === 'GET' && view === 'alerts') {
      const alerts = await getConsolidatedAlerts(userId);
      return res.status(200).json({ alerts, count: alerts.length });
    }

    if (req.method === 'GET' && view === 'hierarchy') {
      const hierarchy = await getPropertyHierarchy(userId);
      return res.status(200).json(hierarchy);
    }

    if (req.method === 'GET' && view === 'branding') {
      const { parkId } = req.query;
      if (!parkId) return res.status(400).json({ error: 'parkId required' });
      const branding = await getBrandingForProperty(parkId);
      return res.status(200).json(branding);
    }

    if (req.method === 'POST' && view === 'bulk-update-rates') {
      const { propertyIds, rateCard, baseRateCents } = req.body;
      if (!propertyIds || !Array.isArray(propertyIds) || (!rateCard && !baseRateCents)) {
        return res.status(400).json({ error: 'propertyIds array and either rateCard or baseRateCents required' });
      }
      const result = await bulkUpdateRates(userId, propertyIds, rateCard || {}, baseRateCents || null);
      return res.status(200).json({ success: true, ...result });
    }

    if (req.method === 'POST' && view === 'bulk-campaign') {
      const { propertyIds, campaign } = req.body;
      if (!propertyIds || !Array.isArray(propertyIds) || !campaign) return res.status(400).json({ error: 'propertyIds array and campaign object required' });
      const result = await bulkSendPromotion(userId, propertyIds, campaign);
      return res.status(200).json({ success: true, ...result });
    }

    if (req.method === 'POST' && view === 'bulk-maintenance') {
      const { propertyIds, siteIds, startDate, endDate, reason } = req.body;
      if (!propertyIds || !startDate || !endDate) return res.status(400).json({ error: 'propertyIds, startDate, and endDate required' });
      const result = await bulkScheduleMaintenance(userId, propertyIds, siteIds || [], startDate, endDate, reason || 'Maintenance');
      return res.status(200).json({ success: true, ...result });
    }

    if (req.method === 'POST' && view === 'branding') {
      const { parkId, branding } = req.body;
      if (!parkId || !branding) return res.status(400).json({ error: 'parkId and branding required' });
      await applyBranding(parkId, branding);
      return res.status(200).json({ success: true, message: 'Branding updated' });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('Multi-property API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

/* ================================================================== */
/* ota — lifted from api/admin/ota.js. Its `verifyStaffSession` import  */
/* doesn't exist (swapped for requireSession) and its `store.query`     */
/* calls used a `getStore()`-style object (swapped for the shared       */
/* `query` export from reservations-store.js). Also fixed its imports,  */
/* which pointed two directories too high (`../../_lib/...`) even       */
/* though the file lives directly under api/admin/ — should be          */
/* `../_lib/...`, same depth as every other route here.                 */
/* ================================================================== */

async function otaHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { method, query, body } = req;
  const { action } = query;

  try {
    switch (method) {
      case 'PUT':
        if (action === 'rates') return otaSyncRates(session.parkId, body, res);
        break;
      case 'GET':
        if (action === 'status') return otaGetStatus(session.parkId, res);
        if (action === 'sync-logs') return otaGetSyncLogs(session.parkId, query, res);
        break;
      case 'POST':
        if (action === 'connect') return otaConnect(session.parkId, body, res);
        break;
      case 'DELETE':
        if (action === 'disconnect') return otaDisconnect(session.parkId, body, res);
        break;
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('OTA admin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function otaSyncRates(parkId, body, res) {
  const { rates, otasToSync, siteId } = body;
  if (!Array.isArray(rates) || !rates.length) return res.status(400).json({ error: 'Rates must be a non-empty array' });

  for (const rate of rates) {
    if (!rate.date || typeof rate.nightlyRateCents !== 'number') {
      return res.status(400).json({ error: 'Each rate must include date and nightlyRateCents' });
    }
  }

  try {
    const park = await getPark(parkId);
    if (!park) return res.status(404).json({ error: 'Park not found' });

    const otaManager = new OTAManager();
    const engine = new AvailabilitySyncEngine(store, otaManager);
    const result = await engine.pushRatesToOTAs(parkId, rates, otasToSync);

    if (!result.success) return res.status(400).json({ error: result.error });

    return res.status(200).json({
      success: true, message: 'Rates synced to connected OTAs', syncId: result.syncId,
      ratesCount: result.ratesCount, otaResults: result.otaResults,
    });
  } catch (error) {
    console.error('Rate sync error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function otaGetStatus(parkId, res) {
  try {
    const park = await getPark(parkId);
    if (!park) return res.status(404).json({ error: 'Park not found' });

    const otaManager = new OTAManager();
    const listingIds = { airbnb: park.airbnbListingId, booking: park.bookingListingId, vrbo: park.vrboListingId };
    const statuses = await otaManager.getAllListingStatuses(listingIds);
    const syncLogs = { airbnb: null, booking: null, vrbo: null };

    return res.status(200).json({ success: true, listings: statuses, lastSyncs: syncLogs });
  } catch (error) {
    console.error('OTA status error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function otaGetSyncLogs(parkId, query, res) {
  try {
    return res.status(200).json({ success: true, count: 0, logs: [] });
  } catch (error) {
    console.error('Sync logs error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function otaConnect(parkId, body, res) {
  const { otaName, listingId, credentials } = body;
  if (!otaName || !listingId || !credentials) return res.status(400).json({ error: 'Missing required fields: otaName, listingId, credentials' });

  try {
    const validOTAs = ['airbnb', 'booking', 'vrbo'];
    if (!validOTAs.includes(otaName)) return res.status(400).json({ error: `Unknown OTA: ${otaName}` });

    const otaManager = new OTAManager();
    await otaManager.initializeOTA(otaName, credentials);

    const updateField = `${otaName}_listing_id`;
    await dbQuery(`UPDATE parks SET ${updateField} = $1 WHERE id = $2`, [listingId, parkId]);

    await dbQuery(
      `INSERT INTO ota_credentials (id, park_id, ota_name, credentials, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (park_id, ota_name) DO UPDATE SET credentials = $4, updated_at = now()`,
      [`cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, parkId, otaName, JSON.stringify(credentials), new Date().toISOString()]
    );

    return res.status(200).json({ success: true, message: `${otaName} connected successfully`, listingId });
  } catch (error) {
    console.error('OTA connection error:', error);
    return res.status(400).json({ error: error.message });
  }
}

async function otaDisconnect(parkId, body, res) {
  const { otaName } = body;
  if (!otaName) return res.status(400).json({ error: 'Missing required field: otaName' });

  try {
    const validOTAs = ['airbnb', 'booking', 'vrbo'];
    if (!validOTAs.includes(otaName)) return res.status(400).json({ error: `Unknown OTA: ${otaName}` });

    const updateField = `${otaName}_listing_id`;
    await dbQuery(`UPDATE parks SET ${updateField} = NULL WHERE id = $1`, [parkId]);
    await dbQuery(`DELETE FROM ota_credentials WHERE park_id = $1 AND ota_name = $2`, [parkId, otaName]);

    return res.status(200).json({ success: true, message: `${otaName} disconnected successfully` });
  } catch (error) {
    console.error('OTA disconnection error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/* ================================================================== */
/* Note: sites (add/edit/delete a site + seasonal rates) and            */
/* staff-booking (front-desk phone/walk-in reservation) are NOT here —  */
/* they were folded into api/admin/dashboard.js instead (resource:      */
/* 'site' / 'season' / 'staff-booking' branches there), since that file */
/* already had a resource-branching POST/DELETE pattern for its own     */
/* park-settings endpoints and folding them in kept the total file      */
/* count under api/ lower than adding them here too.                    */
/* ================================================================== */
/* parks — lifted from api/admin/parks.js (unchanged; super-admin only) */
/* ================================================================== */

async function parksHandler(req, res) {
  const session = requireSession(req, res, { role: 'super-admin' });
  if (!session) return;

  if (req.method === 'GET') {
    return res.status(200).json({ parks: await listParksForAdmin() });
  }

  if (req.method === 'POST') {
    const { name, location, state, timezone, staffUsername, staffPassword } = req.body || {};
    try {
      const park = await createPark({ name, location, state, timezone, staffUsername, staffPassword });
      const { passwordHash, ...safePark } = park;
      return res.status(201).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const { parkId, ghlCrmUrl } = req.body || {};
    if (!parkId) return res.status(400).json({ error: 'parkId is required' });
    try {
      const park = await setParkGhlCrmUrl(parkId, ghlCrmUrl);
      const { passwordHash, ...safePark } = park;
      return res.status(200).json({ park: safePark });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  res.status(405).json({ error: 'Method not allowed' });
}

/* ================================================================== */
/* admin-users — named platform-admin accounts (super-admin only)       */
/* ================================================================== */

async function adminUsersHandler(req, res) {
  const session = requireSession(req, res, { role: 'super-admin' });
  if (!session) return;

  if (req.method === 'GET') {
    return res.status(200).json({ admins: await listAdminUsers() });
  }

  if (req.method === 'POST') {
    const { name, email, phone, password } = req.body || {};
    try {
      const admin = await createAdminUser({ name, email, phone, password });
      return res.status(201).json({ admin });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { adminId } = req.body || {};
    if (!adminId) return res.status(400).json({ error: 'adminId is required' });
    try {
      await removeAdminUser(adminId);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
}

/* ================================================================== */
/* ai-insight — narrates numbers the site already computed (rate        */
/* suggestions, occupancy forecasts, analytics KPIs) via NVIDIA's NIM   */
/* OpenAI-compatible API. Never generates the numbers itself.           */
/* ================================================================== */

const AI_INSIGHT_SYSTEM_PROMPTS = {
  'rate-optimization': 'You are a pricing analyst for an RV park. Given a JSON object with the park\'s current rate, AI-suggested rate, predicted occupancy, and elasticity data, write a 2-3 sentence plain-English summary explaining the recommendation and why. No markdown, no bullet points, speak directly to the park owner.',
  'analytics': 'You are a hospitality revenue analyst for an RV park. Given a JSON object of recent revenue, occupancy, and booking-source KPIs, write a 2-3 sentence plain-English summary of what stands out and one concrete thing worth doing about it. Only state facts the numbers actually support: repeatGuestPercent is the real guest-retention figure — topBookingSources[].source is just the name of a booking channel (e.g. "guest" means bookings made through the park\'s own website booking flow, as opposed to a staff-entered walk-in) and has no connection to repeat guests, so never conflate the two or claim something about repeat guests unless repeatGuestPercent itself supports it. No markdown, no bullet points, speak directly to the park owner.',
  'occupancy-forecast': 'You are a hospitality operations analyst for an RV park. Given a JSON object of occupancy forecast data (today, 30/90-day averages, trend, peak dates), write a 2-3 sentence plain-English outlook and one concrete staffing or pricing implication. No markdown, no bullet points, speak directly to the park owner.',
  'pricing-intelligence': 'You are a pricing analyst for an RV park. Given a JSON object with a date range, aggregate stats (how many nights are suggested to go up/down/stay flat, average change), and a sample of individual suggestions each with a reasoning breakdown (occupancy vs target, how far out the booking window is, season, day of week, final multiplier), write a 2-3 sentence plain-English summary of what\'s actually driving these price changes across the period — e.g. "most of the increase is weekend/peak-season pressure, not occupancy" or "these are mostly early-booking-window discounts." Only state what the reasoning data actually supports — never invent an external cause (a specific holiday, local event, weather) that isn\'t present in the data. No markdown, no bullet points, speak directly to the park owner.',
};

async function aiInsightHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { kind, context } = req.body || {};
  const systemPrompt = AI_INSIGHT_SYSTEM_PROMPTS[kind];
  if (!systemPrompt) return res.status(400).json({ error: 'Unknown insight kind' });
  if (!context || typeof context !== 'object') return res.status(400).json({ error: 'context is required' });

  try {
    const insight = await generateNarrative(systemPrompt, JSON.stringify(context));
    return res.status(200).json({ insight });
  } catch (err) {
    console.error('AI insight error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}

/* ================================================================== */
/* availability-blockers — staff-only. When New Booking's search comes  */
/* back empty, this says WHICH reservation(s) are in the way, so staff  */
/* don't have to go cross-reference the Reservations tab themselves.    */
/* Deliberately NOT part of the public /api/reservations/availability   */
/* endpoint — that one is reachable by any anonymous guest, and this    */
/* includes other guests' names, which only this park's own staff       */
/* should see (staff already see every guest name in the Reservations   */
/* table, so nothing new is exposed here, just surfaced sooner).        */
/* ================================================================== */

async function availabilityBlockersHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { checkIn, checkOut } = req.query;
  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: 'checkIn and checkOut are required' });
  }

  const blockers = await store.getBlockingReservations(session.parkId, checkIn, checkOut);
  return res.status(200).json({ blockers });
}

/* ================================================================== */
/* google-calendar — one-way sync (see api/_lib/google-calendar.js).    */
/* Hardcoded redirect URI: must byte-match what's registered as an      */
/* Authorized redirect URI in Google Cloud Console AND what's sent in    */
/* both the auth-url request and the token exchange, so it's a fixed    */
/* constant rather than derived from request headers (which could be    */
/* spoofed, and would drift across preview/production hostnames).       */
/* ================================================================== */

const GOOGLE_REDIRECT_URI = 'https://www.rvparksuccess.com/api/admin/ops?resource=google-calendar&action=oauth-callback';

async function googleCalendarHandler(req, res) {
  const { action } = req.query;

  if (req.method === 'GET' && action === 'connect-url') {
    const session = requireSession(req, res, { role: 'park-staff' });
    if (!session) return;
    try {
      const url = getGoogleAuthUrl(GOOGLE_REDIRECT_URI, session.parkId);
      return res.status(200).json({ url });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // Google redirects the browser here after consent — a real top-level
  // navigation, not a fetch(), so this always redirects back into the
  // dashboard (success or failure) rather than returning JSON.
  if (req.method === 'GET' && action === 'oauth-callback') {
    const session = requireSession(req, res, { role: 'park-staff' });
    if (!session) return;

    const { code, state, error: googleError } = req.query;
    const redirectBack = (status) => res.redirect(302, `/park-dashboard.html?googleCalendar=${status}#park-settings`);

    if (googleError) return redirectBack('denied');
    if (!code) return redirectBack('error');
    // `state` carries the parkId that started this flow — cross-checked
    // against the actual logged-in session so the connection can never be
    // saved onto a different park than the one that clicked Connect.
    if (state !== session.parkId) return redirectBack('error');

    try {
      const tokens = await exchangeCodeForTokens(code, GOOGLE_REDIRECT_URI);
      if (!tokens.refresh_token) {
        // Google only issues a refresh_token on first-ever consent for
        // this account+app; prompt=consent in getGoogleAuthUrl() should
        // always force a fresh one, so landing here means something
        // upstream changed — safer to say so than silently save a
        // connection that can't actually refresh its access token later.
        return redirectBack('no-refresh-token');
      }
      const email = await getGoogleAccountEmail(tokens.access_token);
      await store.setGoogleCalendarConnection(session.parkId, {
        refreshToken: tokens.refresh_token, calendarId: 'primary', email,
      });
      return redirectBack('connected');
    } catch (err) {
      console.error('Google Calendar OAuth callback error:', err.message);
      return redirectBack('error');
    }
  }

  if (req.method === 'POST' && action === 'disconnect') {
    const session = requireSession(req, res, { role: 'park-staff' });
    if (!session) return;
    try {
      const park = await store.removeGoogleCalendarConnection(session.parkId);
      return res.status(200).json({ park });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}

/* ================================================================== */
/* park-media — park-level photos + one video (NOT per-site), stored    */
/* in Vercel Blob. Upload happens directly browser -> Blob (handleUpload */
/* only issues a short-lived token); this server never receives the     */
/* file bytes.                                                          */
/* ================================================================== */

async function parkMediaHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { action } = req.query;

  if (req.method === 'POST' && action === 'upload-token') {
    try {
      const jsonResponse = await handleUpload({
        request: req,
        body: req.body,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const payload = JSON.parse(clientPayload || '{}');
          const { type } = payload;
          if (type !== 'image' && type !== 'video' && type !== 'logo') throw new Error('A valid media type is required');

          // session.parkId (never anything the client sends) is what
          // actually authorizes this — a park-staff session can only ever
          // upload media for their own park. Logo is a single dedicated
          // field (not part of the gallery), so it has no count cap —
          // uploading a new one just replaces whichever one exists.
          if (type !== 'logo') {
            const existingCount = await store.countParkMedia(session.parkId, type);
            const max = type === 'image' ? store.PARK_MEDIA_MAX_IMAGES : store.PARK_MEDIA_MAX_VIDEOS;
            if (existingCount >= max) {
              throw new Error(type === 'image'
                ? `The park already has the maximum of ${store.PARK_MEDIA_MAX_IMAGES} photos — remove one before adding another.`
                : 'The park already has a video — remove it before uploading a new one.');
            }
          }

          return {
            allowedContentTypes: type === 'video'
              ? ['video/mp4', 'video/quicktime', 'video/webm']
              : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
            maximumSizeInBytes: type === 'video' ? 200 * 1024 * 1024 : (type === 'logo' ? 4 * 1024 * 1024 : 8 * 1024 * 1024),
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ type }),
          };
        },
        // onUploadCompleted is intentionally not implemented — it requires
        // Vercel Blob to call back to a publicly reachable URL, which
        // never works against localhost during local dev/testing. The
        // client calls action=attach itself right after upload() resolves
        // instead, using the exact blob URL/pathname it already has
        // synchronously — no server-to-server callback needed.
      });
      return res.status(200).json(jsonResponse);
    } catch (err) {
      console.error('Park media upload-token error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'attach') {
    const { type, url, pathname } = req.body || {};
    if (!type || !url || !pathname) {
      return res.status(400).json({ error: 'type, url, and pathname are required' });
    }
    try {
      if (type === 'logo') {
        const { park, oldPathname } = await store.setParkLogo(session.parkId, { url, pathname });
        if (oldPathname) {
          await deleteBlob(oldPathname).catch((err) => console.error('Old logo blob delete failed:', err.message));
        }
        return res.status(200).json({ park });
      }
      const media = await store.addParkMedia(session.parkId, { type, url, pathname });
      return res.status(200).json({ media });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && action === 'remove-logo') {
    try {
      const { park, oldPathname } = await store.removeParkLogo(session.parkId);
      if (oldPathname) {
        await deleteBlob(oldPathname).catch((err) => console.error('Logo blob delete failed (DB field already cleared):', err.message));
      }
      return res.status(200).json({ park });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { mediaId } = req.query;
    if (!mediaId) return res.status(400).json({ error: 'mediaId is required' });
    try {
      const pathname = await store.deleteParkMedia(mediaId, session.parkId);
      // The DB row is already gone at this point — a failed blob delete
      // just leaves an orphaned file (a storage cost, not a data-integrity
      // problem), so it's logged rather than failing the whole request.
      await deleteBlob(pathname).catch((err) => console.error('Blob delete failed (DB row already removed):', err.message));
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

/* ================================================================== */
/* expenses — operating expense tracking + Net Operating Income, the   */
/* missing half of a real income/expense report (revenue was already   */
/* tracked via real bookings). Receipt upload reuses the same direct   */
/* browser -> Blob pattern as site-media, above.                       */
/* ================================================================== */

async function expensesHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { action } = req.query;

  if (req.method === 'GET') {
    const { startDate, endDate } = req.query;
    try {
      const expenses = await store.getExpensesForPark(session.parkId, startDate || null, endDate || null);
      // Only compute the NOI summary when a real range was given — an
      // unbounded "all time" summary would be misleading to show as a
      // headline number without the reader knowing what period it covers.
      const summary = (startDate && endDate)
        ? await store.getIncomeExpenseSummary(session.parkId, startDate, endDate)
        : null;
      return res.status(200).json({ expenses, summary, categories: store.EXPENSE_CATEGORIES });
    } catch (err) {
      console.error('Expenses list error:', err.message);
      return res.status(500).json({ error: 'Could not load expenses' });
    }
  }

  if (req.method === 'POST' && action === 'upload-token') {
    try {
      const jsonResponse = await handleUpload({
        request: req,
        body: req.body,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
          maximumSizeInBytes: 8 * 1024 * 1024,
          addRandomSuffix: true,
        }),
      });
      return res.status(200).json(jsonResponse);
    } catch (err) {
      console.error('Expense receipt upload-token error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'create') {
    const { category, description, amountCents, expenseDate, receiptUrl, receiptPathname } = req.body || {};
    try {
      const expense = await store.addExpense(session.parkId, { category, description, amountCents, expenseDate, receiptUrl, receiptPathname });
      return res.status(200).json({ expense });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { expenseId } = req.query;
    if (!expenseId) return res.status(400).json({ error: 'expenseId is required' });
    try {
      const receiptPathname = await store.deleteExpense(expenseId, session.parkId);
      if (receiptPathname) {
        await deleteBlob(receiptPathname).catch((err) => console.error('Receipt blob delete failed (DB row already removed):', err.message));
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
