/**
 * SMS Delivery API
 * Handles SMS sending for reservations with template rendering and delivery tracking
 */

const express = require('express');
const db = require('../db');
const TwilioSMSService = require('../lib/sms-service');
const { renderTemplate, validateVariables } = require('../lib/sms-templates');
const SMSScheduler = require('../lib/sms-scheduler');
const auth = require('../middleware/auth');

const router = express.Router();
const scheduler = new SMSScheduler();

/**
 * Initialize Twilio service (called once on startup)
 */
let twilioService = null;

function initializeTwilio() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (accountSid && authToken) {
    try {
      twilioService = new TwilioSMSService(accountSid, authToken);
      console.log('[SMS] Twilio service initialized');
      // Load pending messages
      scheduler.processPendingMessages();
    } catch (error) {
      console.error('[SMS] Failed to initialize Twilio:', error.message);
    }
  } else {
    console.warn('[SMS] Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
  }
}

/**
 * POST /api/sms/send
 * Send SMS to guest with template
 * Body: { reservationId, templateType, phoneNumber?, guestId? }
 */
router.post('/send', auth, async (req, res) => {
  try {
    if (!twilioService) {
      return res.status(503).json({
        error: 'SMS service not configured',
        message: 'Twilio credentials are not set up'
      });
    }

    const { reservationId, templateType, phoneNumber, guestId } = req.body;

    // Validate inputs
    if (!reservationId || !templateType) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['reservationId', 'templateType']
      });
    }

    // Get reservation data
    let reservation, guest, park;
    try {
      const reservationStmt = db.prepare(`
        SELECT r.*, p.id as parkId, p.twilioPhoneNumber, p.smsEnabled, p.quietHoursStart, p.quietHoursEnd
        FROM reservations r
        LEFT JOIN parks p ON r.parkId = p.id
        WHERE r.id = ?
      `);
      reservation = reservationStmt.get(reservationId);

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // Get guest data
      const guestStmt = db.prepare(`
        SELECT * FROM guests
        WHERE id = ? OR (reservationId = ? AND id = ?)
        LIMIT 1
      `);
      guest = guestStmt.get(guestId || reservation.guestId, reservationId, guestId);

      if (!guest) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      park = reservation;
    } catch (error) {
      return res.status(400).json({ error: 'Failed to fetch reservation data', message: error.message });
    }

    // Check SMS opt-in
    if (!guest.smsOptIn) {
      return res.status(403).json({
        error: 'Guest has not opted in to SMS',
        message: 'Cannot send SMS to this guest'
      });
    }

    // Check if SMS is enabled for park
    if (!park.smsEnabled) {
      return res.status(403).json({
        error: 'SMS not enabled for this park',
        message: 'Park owner has not enabled SMS notifications'
      });
    }

    // Validate phone number
    const phone = phoneNumber || guest.phoneNumber;
    if (!phone) {
      return res.status(400).json({ error: 'No phone number available' });
    }

    if (!TwilioSMSService.validatePhoneNumber(phone)) {
      return res.status(400).json({
        error: 'Invalid phone number format',
        message: 'Phone number must be in E.164 format or valid 10-digit US number'
      });
    }

    const formattedPhone = TwilioSMSService.formatPhoneNumber(phone);

    // Prepare template variables
    const templateVars = {
      guestName: guest.firstName || guest.name || '',
      parkName: park.name || '',
      checkInDate: reservation.checkInDate || '',
      checkOutDate: reservation.checkOutDate || '',
      checkInTime: reservation.checkInTime || '3:00 PM',
      checkOutTime: reservation.checkOutTime || '11:00 AM',
      siteNumber: reservation.siteNumber || '',
      parkPhone: park.contactPhone || '',
      parkAddress: park.address || '',
      parkingLocation: park.parkingLocation || 'Front parking area',
      officeLocation: park.officeLocation || 'Main office',
      wifiSSID: park.wifiSSID || '',
      wifiPassword: park.wifiPassword || '',
      reviewLink: park.reviewLink || 'https://gritrvpark.com/reviews',
      amount: reservation.depositAmount || '',
      paymentLink: `https://gritrvpark.com/pay/${reservationId}`,
      refundAmount: reservation.depositAmount || '',
      ...req.body.variables
    };

    // Validate template variables
    const validation = validateVariables(templateType, templateVars);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Missing template variables',
        missing: validation.missing,
        provided: Object.keys(templateVars)
      });
    }

    // Render template
    const message = renderTemplate(templateType, templateVars);

    // Check message length
    if (message.length > 1600) {
      return res.status(400).json({
        error: 'Message too long',
        message: `Message is ${message.length} characters (max 1600)`
      });
    }

    // Send SMS
    const sendResult = await twilioService.sendSMS(
      formattedPhone,
      park.twilioPhoneNumber,
      message
    );

    // Log delivery
    let smsLogId = null;
    try {
      const logStmt = db.prepare(`
        INSERT INTO sms_logs (
          reservationId, guestId, templateType, message, status,
          messageId, phoneNumber, sentAt, deliveryStatus
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = logStmt.run(
        reservationId,
        guest.id,
        templateType,
        message,
        sendResult.status,
        sendResult.messageId,
        formattedPhone,
        new Date().toISOString(),
        sendResult.status === 'failed' ? 'failed' : 'queued'
      );

      smsLogId = result.lastInsertRowid;
    } catch (error) {
      console.error('Error logging SMS delivery:', error);
    }

    // Schedule retry if failed
    if (sendResult.status === 'failed') {
      scheduler.scheduleMessage({
        messageId: smsLogId,
        phoneNumber: formattedPhone,
        fromNumber: park.twilioPhoneNumber,
        message: message,
        sendTime: 'immediately', // Will retry immediately
        reservationId,
        templateType,
        parkId: park.parkId,
        guestId: guest.id,
        quietStart: park.quietHoursStart,
        quietEnd: park.quietHoursEnd
      });
    }

    res.json({
      status: sendResult.status,
      messageId: sendResult.messageId,
      smsLogId: smsLogId,
      sentAt: sendResult.sentAt,
      phoneNumber: formattedPhone,
      templateType: templateType,
      error: sendResult.error || null
    });

  } catch (error) {
    console.error('[SMS] Error sending SMS:', error);
    res.status(500).json({
      error: 'Failed to send SMS',
      message: error.message
    });
  }
});

/**
 * POST /api/sms/schedule
 * Schedule SMS for later delivery
 */
router.post('/schedule', auth, async (req, res) => {
  try {
    const {
      reservationId,
      templateType,
      sendTime,
      phoneNumber,
      guestId
    } = req.body;

    if (!reservationId || !templateType || !sendTime) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['reservationId', 'templateType', 'sendTime']
      });
    }

    // Validate sendTime format
    const delay = SMSScheduler.calculateDelay(sendTime);
    if (delay === null && !sendTime.includes('+') && !sendTime.includes('-')) {
      return res.status(400).json({
        error: 'Invalid sendTime format',
        message: 'Use "immediately", specific time (e.g., "8:00 AM"), or relative time (e.g., "checkInDate+24h")'
      });
    }

    // Schedule message
    const scheduleId = scheduler.scheduleMessage({
      messageId: null,
      phoneNumber: phoneNumber,
      fromNumber: process.env.TWILIO_PHONE_NUMBER,
      message: '', // Will be rendered when sent
      sendTime,
      reservationId,
      templateType,
      guestId: guestId
    });

    res.json({
      scheduled: true,
      scheduleId: scheduleId,
      sendTime: sendTime
    });

  } catch (error) {
    console.error('[SMS] Error scheduling SMS:', error);
    res.status(500).json({
      error: 'Failed to schedule SMS',
      message: error.message
    });
  }
});

/**
 * GET /api/sms/logs
 * Get SMS delivery logs
 * Query params: reservationId, guestId, status, limit, offset
 */
router.get('/logs', auth, (req, res) => {
  try {
    const { reservationId, guestId, status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM sms_logs WHERE 1=1';
    const params = [];

    if (reservationId) {
      query += ' AND reservationId = ?';
      params.push(reservationId);
    }

    if (guestId) {
      query += ' AND guestId = ?';
      params.push(guestId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY sentAt DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const stmt = db.prepare(query);
    const logs = stmt.all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM sms_logs WHERE 1=1';
    const countParams = [];

    if (reservationId) {
      countQuery += ' AND reservationId = ?';
      countParams.push(reservationId);
    }
    if (guestId) {
      countQuery += ' AND guestId = ?';
      countParams.push(guestId);
    }
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const countStmt = db.prepare(countQuery);
    const { count } = countStmt.get(...countParams);

    res.json({
      logs,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(count / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('[SMS] Error fetching logs:', error);
    res.status(500).json({
      error: 'Failed to fetch SMS logs',
      message: error.message
    });
  }
});

/**
 * GET /api/sms/message-status/:messageSid
 * Get status of a sent SMS
 */
router.get('/message-status/:messageSid', auth, async (req, res) => {
  try {
    if (!twilioService) {
      return res.status(503).json({ error: 'SMS service not configured' });
    }

    const { messageSid } = req.params;
    const status = await twilioService.getMessageStatus(messageSid);

    res.json(status);

  } catch (error) {
    console.error('[SMS] Error getting message status:', error);
    res.status(500).json({
      error: 'Failed to get message status',
      message: error.message
    });
  }
});

/**
 * GET /api/sms/status
 * Get SMS service status and configuration
 */
router.get('/status', auth, (req, res) => {
  const isConfigured = twilioService !== null;
  const hasCredentials = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );

  res.json({
    configured: isConfigured,
    hasCredentials: hasCredentials,
    accountSid: process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_ACCOUNT_SID.substring(0, 8) + '***' : null,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || null,
    scheduledMessages: scheduler.getScheduledMessages().length,
    activeTimers: scheduler.activeTimers.size
  });
});

/**
 * DELETE /api/sms/scheduled/:scheduleId
 * Cancel a scheduled SMS
 */
router.delete('/scheduled/:scheduleId', auth, (req, res) => {
  try {
    const { scheduleId } = req.params;
    const cancelled = scheduler.cancelScheduledMessage(scheduleId);

    res.json({
      cancelled: cancelled,
      scheduleId: scheduleId
    });

  } catch (error) {
    console.error('[SMS] Error cancelling scheduled message:', error);
    res.status(500).json({
      error: 'Failed to cancel scheduled message',
      message: error.message
    });
  }
});

/**
 * Initialize on first use
 */
if (!twilioService && (process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_AUTH_TOKEN)) {
  initializeTwilio();
}

module.exports = { router, scheduler, initializeTwilio };
