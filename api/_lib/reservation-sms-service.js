/**
 * Reservation SMS Service
 * Integrates SMS automation into reservation lifecycle
 * Automatically sends confirmations, reminders, and follow-ups
 */

const db = require('../db');

class ReservationSMSService {
  /**
   * Handle new reservation - send confirmation and schedule reminders
   * @param {object} reservation - Reservation data
   * @param {object} guest - Guest data
   * @param {object} park - Park data
   * @param {function} sendSMS - Function to send SMS (from SMS API)
   */
  static async handleNewReservation(reservation, guest, park, sendSMS) {
    try {
      if (!park.smsEnabled || !guest.smsOptIn) {
        console.log('[SMS] SMS disabled or guest not opted in');
        return;
      }

      // 1. Send immediate confirmation
      const confirmationResult = await sendSMS({
        reservationId: reservation.id,
        templateType: 'confirmation',
        phoneNumber: guest.phoneNumber,
        guestId: guest.id
      });

      if (confirmationResult.status !== 'failed') {
        console.log(`[SMS] Confirmation sent to ${guest.phoneNumber}: ${confirmationResult.messageId}`);
      } else {
        console.error(`[SMS] Failed to send confirmation: ${confirmationResult.error}`);
      }

      // 2. Schedule pre-arrival reminder (24h before check-in)
      await this.scheduleReminder(
        reservation.id,
        guest.id,
        'reminder',
        'checkInDate-24h',
        park
      );

      // 3. Schedule check-in day message (8am on arrival date)
      await this.scheduleReminder(
        reservation.id,
        guest.id,
        'checkin',
        '8:00 AM',  // Will be sent on checkInDate at 8am
        park
      );

      // 4. Schedule post-stay thank you (24h after checkout)
      await this.scheduleReminder(
        reservation.id,
        guest.id,
        'thankyou',
        'checkOutDate+24h',
        park
      );

    } catch (error) {
      console.error('[SMS] Error handling new reservation:', error);
    }
  }

  /**
   * Handle reservation cancellation - send cancellation notice
   */
  static async handleCancellation(reservation, guest, park, sendSMS) {
    try {
      if (!park.smsEnabled || !guest.smsOptIn) return;

      const result = await sendSMS({
        reservationId: reservation.id,
        templateType: 'cancellation',
        guestId: guest.id
      });

      console.log(`[SMS] Cancellation notice sent: ${result.messageId}`);

      // Cancel any scheduled reminders
      this.cancelScheduledReminders(reservation.id);

    } catch (error) {
      console.error('[SMS] Error handling cancellation:', error);
    }
  }

  /**
   * Send payment reminder if deposit not paid
   */
  static async sendPaymentReminder(reservation, guest, park, sendSMS) {
    try {
      if (!park.smsEnabled || !guest.smsOptIn) return;

      // Check if payment already received
      if (reservation.depositAmount && reservation.depositPaid) {
        return;
      }

      const result = await sendSMS({
        reservationId: reservation.id,
        templateType: 'payment',
        guestId: guest.id
      });

      console.log(`[SMS] Payment reminder sent: ${result.messageId}`);

    } catch (error) {
      console.error('[SMS] Error sending payment reminder:', error);
    }
  }

  /**
   * Send check-out reminder on departure date
   */
  static async sendCheckoutReminder(reservation, guest, park, sendSMS) {
    try {
      if (!park.smsEnabled || !guest.smsOptIn) return;

      const result = await sendSMS({
        reservationId: reservation.id,
        templateType: 'checkout',
        guestId: guest.id
      });

      console.log(`[SMS] Checkout reminder sent: ${result.messageId}`);

    } catch (error) {
      console.error('[SMS] Error sending checkout reminder:', error);
    }
  }

  /**
   * Send WiFi credentials to guest
   */
  static async sendWifiCredentials(reservation, guest, park, sendSMS) {
    try {
      if (!park.smsEnabled || !guest.smsOptIn) return;
      if (!park.wifiSSID || !park.wifiPassword) {
        console.log('[SMS] WiFi credentials not configured for park');
        return;
      }

      const result = await sendSMS({
        reservationId: reservation.id,
        templateType: 'wifi',
        guestId: guest.id
      });

      console.log(`[SMS] WiFi credentials sent: ${result.messageId}`);

    } catch (error) {
      console.error('[SMS] Error sending WiFi credentials:', error);
    }
  }

  /**
   * Send service alert to all guests currently at park
   */
  static async sendServiceAlert(parkId, alertMessage, contactInfo, sendSMS) {
    try {
      const park = db.prepare('SELECT * FROM parks WHERE id = ?').get(parkId);
      if (!park || !park.smsEnabled) return;

      // Find all guests checked in today
      const activeGuests = db.prepare(`
        SELECT DISTINCT g.* FROM guests g
        JOIN reservations r ON g.id = r.guestId
        WHERE r.parkId = ?
          AND g.smsOptIn = 1
          AND date(r.checkInDate) <= date('now')
          AND date(r.checkOutDate) >= date('now')
      `).all(parkId);

      let sent = 0;
      for (const guest of activeGuests) {
        const result = await sendSMS({
          reservationId: guest.reservationId,
          templateType: 'alert',
          phoneNumber: guest.phoneNumber,
          guestId: guest.id,
          variables: {
            alertMessage,
            contactInfo
          }
        });

        if (result.status !== 'failed') sent++;
      }

      console.log(`[SMS] Service alert sent to ${sent} guests at park ${parkId}`);

    } catch (error) {
      console.error('[SMS] Error sending service alert:', error);
    }
  }

  /**
   * Send promotional offer to past guests
   */
  static async sendPromotion(parkId, offerDescription, bookingLink, offerExpiry, sendSMS) {
    try {
      const park = db.prepare('SELECT * FROM parks WHERE id = ?').get(parkId);
      if (!park || !park.smsEnabled) return;

      // Find past guests who opted in
      const pastGuests = db.prepare(`
        SELECT DISTINCT g.* FROM guests g
        JOIN reservations r ON g.id = r.guestId
        WHERE r.parkId = ?
          AND g.smsOptIn = 1
          AND date(r.checkOutDate) < date('now')
        ORDER BY r.checkOutDate DESC
        LIMIT 100
      `).all(parkId);

      let sent = 0;
      for (const guest of pastGuests) {
        const result = await sendSMS({
          reservationId: guest.reservationId,
          templateType: 'promotional',
          phoneNumber: guest.phoneNumber,
          guestId: guest.id,
          variables: {
            offerDescription,
            bookingLink,
            offerExpiry
          }
        });

        if (result.status !== 'failed') sent++;
      }

      console.log(`[SMS] Promotion sent to ${sent} past guests at park ${parkId}`);

    } catch (error) {
      console.error('[SMS] Error sending promotion:', error);
    }
  }

  /**
   * Internal: Schedule a reminder for later
   */
  static async scheduleReminder(reservationId, guestId, templateType, sendTime, park, scheduler) {
    try {
      const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      if (!reservation) return;

      // Store in database for persistence
      const stmt = db.prepare(`
        INSERT INTO sms_scheduled (
          schedule_id, reservation_id, guest_id, phone_number, from_number,
          template_type, send_time, status, park_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const scheduleId = `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      stmt.run(
        scheduleId,
        reservationId,
        guestId,
        '', // Will be looked up when sending
        park.twilioPhoneNumber,
        templateType,
        sendTime,
        'pending',
        park.id,
        new Date().toISOString()
      );

      console.log(`[SMS] Scheduled ${templateType} reminder for ${sendTime}`);

    } catch (error) {
      console.error('[SMS] Error scheduling reminder:', error);
    }
  }

  /**
   * Internal: Cancel all scheduled reminders for a reservation
   */
  static cancelScheduledReminders(reservationId) {
    try {
      const stmt = db.prepare(`
        UPDATE sms_scheduled
        SET status = 'cancelled'
        WHERE reservation_id = ? AND status = 'pending'
      `);

      const result = stmt.run(reservationId);
      console.log(`[SMS] Cancelled ${result.changes} scheduled reminders`);

    } catch (error) {
      console.error('[SMS] Error cancelling scheduled reminders:', error);
    }
  }

  /**
   * Get SMS summary statistics for a park
   */
  static getStatistics(parkId) {
    try {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as totalSent,
          SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN strftime('%Y-%m', sentAt) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) as thisMonth,
          COUNT(DISTINCT templateType) as templateTypes
        FROM sms_logs l
        JOIN reservations r ON l.reservationId = r.id
        WHERE r.parkId = ?
      `).get(parkId);

      const deliveryRate = stats.totalSent > 0
        ? Math.round((stats.delivered / stats.totalSent) * 100)
        : 0;

      return {
        totalSent: stats.totalSent || 0,
        delivered: stats.delivered || 0,
        failed: stats.failed || 0,
        thisMonth: stats.thisMonth || 0,
        deliveryRate: `${deliveryRate}%`,
        templateTypes: stats.templateTypes || 0
      };

    } catch (error) {
      console.error('[SMS] Error getting statistics:', error);
      return null;
    }
  }

  /**
   * Get recent SMS activity
   */
  static getRecentActivity(parkId, limit = 10) {
    try {
      return db.prepare(`
        SELECT
          l.id, g.firstName, g.phoneNumber, l.templateType,
          l.status, l.sentAt
        FROM sms_logs l
        JOIN reservations r ON l.reservationId = r.id
        LEFT JOIN guests g ON l.guestId = g.id
        WHERE r.parkId = ?
        ORDER BY l.sentAt DESC
        LIMIT ?
      `).all(parkId, limit);

    } catch (error) {
      console.error('[SMS] Error getting recent activity:', error);
      return [];
    }
  }
}

module.exports = ReservationSMSService;
