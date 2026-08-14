/**
 * Twilio Webhook Handler
 * Receives SMS delivery status updates from Twilio
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

/**
 * POST /api/webhooks/twilio-status
 * Webhook endpoint for Twilio delivery status callbacks
 * Twilio sends: MessageSid, MessageStatus (delivered, failed, undelivered, etc.)
 */
router.post('/twilio-status', (req, res) => {
  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

    if (!MessageSid || !MessageStatus) {
      console.warn('[Twilio Webhook] Missing required fields in webhook');
      return res.sendStatus(400);
    }

    console.log(`[Twilio Webhook] Status update: ${MessageSid} -> ${MessageStatus}`);

    // Map Twilio status to our status
    let dbStatus = MessageStatus;
    if (MessageStatus === 'delivered') dbStatus = 'delivered';
    if (MessageStatus === 'failed') dbStatus = 'failed';
    if (MessageStatus === 'undelivered') dbStatus = 'failed';
    if (MessageStatus === 'sent') dbStatus = 'sent';
    if (MessageStatus === 'queued') dbStatus = 'queued';

    // Update SMS log
    try {
      const updateStmt = db.prepare(`
        UPDATE sms_logs
        SET status = ?, deliveryStatus = ?, errorCode = ?, errorMessage = ?, updatedAt = ?
        WHERE messageId = ?
      `);

      updateStmt.run(
        dbStatus,
        MessageStatus,
        ErrorCode || null,
        ErrorMessage || null,
        new Date().toISOString(),
        MessageSid
      );
    } catch (error) {
      console.error('[Twilio Webhook] Error updating SMS log:', error);
    }

    // Alert if delivery failed
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      console.error(`[Twilio] SMS delivery failed: ${MessageSid}`, {
        status: MessageStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage
      });

      // Check for repeated failures (alert threshold)
      try {
        const recentFailures = db.prepare(`
          SELECT COUNT(*) as count FROM sms_logs
          WHERE status = 'failed' AND sentAt > datetime('now', '-1 hour')
        `).get();

        if (recentFailures.count >= 10) {
          console.error('[SMS Alert] Multiple SMS failures detected - possible service issue');
          // TODO: Send alert to park owner
        }
      } catch (error) {
        console.error('[SMS] Error checking failure rate:', error);
      }
    }

    // Return 200 to acknowledge receipt
    res.sendStatus(200);

  } catch (error) {
    console.error('[Twilio Webhook] Error processing webhook:', error);
    res.sendStatus(500);
  }
});

/**
 * POST /api/webhooks/twilio-inbound
 * Handle inbound SMS (replies from guests)
 * Twilio sends: From, To, Body, MessageSid
 */
router.post('/twilio-inbound', (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;

    if (!From || !Body) {
      console.warn('[Twilio Inbound] Missing required fields');
      return res.sendStatus(400);
    }

    console.log(`[Twilio Inbound] Received SMS from ${From}: "${Body}"`);

    // Check for opt-out command
    if (Body.toUpperCase().trim() === 'STOP') {
      handleOptOut(From);
    }

    // Store inbound message
    try {
      const stmt = db.prepare(`
        INSERT INTO sms_inbound (
          twilio_sid, from_number, to_number, message, received_at
        ) VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        MessageSid,
        From,
        To,
        Body,
        new Date().toISOString()
      );
    } catch (error) {
      console.error('[SMS] Error storing inbound message:', error);
    }

    // Return 200 to acknowledge receipt
    res.sendStatus(200);

  } catch (error) {
    console.error('[Twilio Inbound] Error processing inbound SMS:', error);
    res.sendStatus(500);
  }
});

/**
 * Handle SMS opt-out (STOP command)
 */
function handleOptOut(phoneNumber) {
  try {
    const stmt = db.prepare(`
      UPDATE guests
      SET smsOptIn = 0, smsOptOutDate = ?
      WHERE phoneNumber = ?
    `);

    const result = stmt.run(new Date().toISOString(), phoneNumber);

    if (result.changes > 0) {
      console.log(`[SMS] Opt-out processed for ${phoneNumber}`);
    }
  } catch (error) {
    console.error('[SMS] Error processing opt-out:', error);
  }
}

/**
 * GET /api/webhooks/twilio-status (for testing)
 * Returns webhook configuration info
 */
router.get('/twilio-status', (req, res) => {
  res.json({
    webhook: 'twilio-status',
    method: 'POST',
    purpose: 'Receives SMS delivery status updates from Twilio',
    expects: ['MessageSid', 'MessageStatus', 'ErrorCode', 'ErrorMessage'],
    configured: Boolean(process.env.TWILIO_WEBHOOK_URL)
  });
});

module.exports = router;
