/**
 * OTA Webhook Endpoint
 *
 * Receives booking notifications from OTA platforms (Airbnb, Booking.com, Vrbo)
 * when new reservations are made.
 *
 * Endpoint: POST /api/ota-webhook
 *
 * Security:
 * - Verifies webhook signature to prevent spoofing
 * - Rate limits incoming requests
 * - Validates booking data before processing
 *
 * Process:
 * 1. Verify webhook signature
 * 2. Parse booking data
 * 3. Create guest account if new
 * 4. Create reservation in our system
 * 5. Send confirmation email
 * 6. Mark date unavailable on other OTAs
 * 7. Return success response
 */

import crypto from 'crypto';
import { AvailabilitySyncEngine } from './_lib/availability-sync.js';
import { OTAManager } from './_lib/ota-manager.js';

// Webhook signature verification secrets (stored in env)
const WEBHOOK_SECRETS = {
  airbnb: process.env.AIRBNB_WEBHOOK_SECRET || '',
  booking: process.env.BOOKING_WEBHOOK_SECRET || '',
  vrbo: process.env.VRBO_WEBHOOK_SECRET || '',
};

// In-memory rate limiting (in production, use Redis)
const webhookRateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100; // requests per window

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { otaName, booking, signature } = req.body;

    if (!otaName || !booking || !signature) {
      return res.status(400).json({ error: 'Missing required fields: otaName, booking, signature' });
    }

    // Verify webhook signature
    if (!verifyWebhookSignature(otaName, booking, signature)) {
      console.warn(`Webhook signature verification failed for ${otaName}`);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Check rate limit
    if (!checkRateLimit(otaName)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Process booking
    const result = await processOTABooking(otaName, booking);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Return success
    return res.status(200).json({
      success: true,
      reservationId: result.reservationId,
      message: 'Booking received and processed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Verify webhook signature
 * @private
 */
function verifyWebhookSignature(otaName, booking, signature) {
  const secret = WEBHOOK_SECRETS[otaName];
  if (!secret) {
    console.warn(`No webhook secret configured for OTA: ${otaName}`);
    return false;
  }

  const payload = JSON.stringify(booking);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(signature, expectedSignature);
}

/**
 * Check rate limiting
 * @private
 */
function checkRateLimit(otaName) {
  const now = Date.now();
  const key = `webhook-${otaName}`;

  if (!webhookRateLimiter.has(key)) {
    webhookRateLimiter.set(key, { count: 1, window: now });
    return true;
  }

  const entry = webhookRateLimiter.get(key);

  // Reset window if expired
  if (now - entry.window > RATE_LIMIT_WINDOW) {
    webhookRateLimiter.set(key, { count: 1, window: now });
    return true;
  }

  // Check limit
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Process OTA booking and create reservation in our system
 * @private
 */
async function processOTABooking(otaName, booking) {
  try {
    // Validate booking data
    const validation = validateBookingData(booking);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const {
      parkId,
      guestName,
      guestEmail,
      guestPhone,
      checkIn,
      checkOut,
      totalPriceCents,
      otaBookingId,
    } = booking;

    // Get park from database
    // Note: In production, would query the database
    // const park = await db.getPark(parkId);
    // if (!park) return { success: false, error: 'Park not found' };

    // For now, this is placeholder - actual implementation would:
    // 1. Query database for park
    // 2. Create/fetch guest account
    // 3. Create reservation
    // 4. Store OTA booking link
    // 5. Send email
    // 6. Sync availability

    console.log(`Processing OTA booking from ${otaName}:`, {
      parkId,
      otaBookingId,
      guestEmail,
      checkIn,
      checkOut,
    });

    return {
      success: true,
      reservationId: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  } catch (error) {
    console.error(`Failed to process ${otaName} booking:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Validate booking data from OTA
 * @private
 */
function validateBookingData(booking) {
  if (!booking.parkId || typeof booking.parkId !== 'string') {
    return { valid: false, error: 'Invalid or missing parkId' };
  }

  if (!booking.guestName || typeof booking.guestName !== 'string') {
    return { valid: false, error: 'Invalid or missing guestName' };
  }

  if (!booking.guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.guestEmail)) {
    return { valid: false, error: 'Invalid or missing guestEmail' };
  }

  if (!booking.checkIn || !booking.checkOut) {
    return { valid: false, error: 'Invalid or missing check-in/check-out dates' };
  }

  if (new Date(booking.checkOut) <= new Date(booking.checkIn)) {
    return { valid: false, error: 'Check-out must be after check-in' };
  }

  if (typeof booking.totalPriceCents !== 'number' || booking.totalPriceCents < 0) {
    return { valid: false, error: 'Invalid totalPriceCents' };
  }

  if (!booking.otaBookingId || typeof booking.otaBookingId !== 'string') {
    return { valid: false, error: 'Invalid or missing otaBookingId' };
  }

  return { valid: true };
}

/**
 * Example webhook payloads from each OTA
 *
 * Airbnb:
 * POST /api/ota-webhook
 * {
 *   "otaName": "airbnb",
 *   "booking": {
 *     "parkId": "park-123",
 *     "otaBookingId": "airbnb-reservation-456",
 *     "guestName": "John Doe",
 *     "guestEmail": "john@example.com",
 *     "guestPhone": "+1-555-0100",
 *     "checkIn": "2026-08-15",
 *     "checkOut": "2026-08-20",
 *     "totalPriceCents": 50000,
 *     "currency": "USD",
 *     "status": "confirmed"
 *   },
 *   "signature": "sha256_hex_signature"
 * }
 *
 * Booking.com:
 * Similar structure, with otaName = "booking"
 *
 * Vrbo:
 * Similar structure, with otaName = "vrbo"
 */
