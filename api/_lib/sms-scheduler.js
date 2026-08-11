/**
 * SMS Scheduler
 * Manages scheduling and sending SMS at specific times with quiet hours support
 */

const db = require('../db');

class SMSScheduler {
  constructor() {
    this.scheduledMessages = new Map();
    this.activeTimers = new Map();
  }

  /**
   * Parse time string (e.g., '8:00 AM', '20:30')
   * @returns {object} {hours, minutes}
   */
  static parseTimeString(timeStr) {
    if (!timeStr) return null;

    const timeRegex = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/;
    const match = timeStr.match(timeRegex);

    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  /**
   * Check if current time is within quiet hours
   * @param {string} quietStart - Start time (e.g., '9:00 PM')
   * @param {string} quietEnd - End time (e.g., '8:00 AM')
   * @returns {boolean}
   */
  static isQuietHours(quietStart, quietEnd) {
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTime = currentHours * 60 + currentMinutes;

    const start = this.parseTimeString(quietStart);
    const end = this.parseTimeString(quietEnd);

    if (!start || !end) return false;

    const startTime = start.hours * 60 + start.minutes;
    const endTime = end.hours * 60 + end.minutes;

    // Handle overnight quiet hours (e.g., 9 PM to 8 AM)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    } else {
      return currentTime >= startTime && currentTime < endTime;
    }
  }

  /**
   * Calculate delay until send time
   * @param {string|Date} sendTime - When to send
   * @returns {number} Milliseconds until send time
   */
  static calculateDelay(sendTime) {
    const now = new Date();
    let targetTime;

    if (typeof sendTime === 'string') {
      if (sendTime === 'immediately') return 0;
      if (sendTime === 'scheduled') return null; // Manual scheduling

      // Handle relative times (e.g., 'checkInDate+24h', 'checkOutDate-1h')
      if (sendTime.includes('+') || sendTime.includes('-')) {
        const parts = sendTime.match(/^(\w+)([\+\-])(\d+)([hmd])$/);
        if (!parts) return null;

        const [_, anchor, operator, value, unit] = parts;
        let offsetMs = 0;

        switch (unit) {
          case 'h':
            offsetMs = parseInt(value) * 60 * 60 * 1000;
            break;
          case 'd':
            offsetMs = parseInt(value) * 24 * 60 * 60 * 1000;
            break;
          case 'm':
            offsetMs = parseInt(value) * 60 * 1000;
            break;
        }

        if (operator === '-') offsetMs = -offsetMs;
        // Note: anchor date handling should be done in caller context
        return offsetMs;
      }

      // Handle specific time (e.g., '8:00 AM')
      const parsed = this.parseTimeString(sendTime);
      if (!parsed) return null;

      targetTime = new Date(now);
      targetTime.setHours(parsed.hours, parsed.minutes, 0, 0);

      // If time has passed today, schedule for tomorrow
      if (targetTime <= now) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
    } else if (sendTime instanceof Date) {
      targetTime = sendTime;
    } else {
      return null;
    }

    const delay = targetTime - now;
    return delay > 0 ? delay : 0;
  }

  /**
   * Schedule SMS to be sent later
   * @param {object} options - Scheduling options
   * @returns {string} Schedule ID
   */
  scheduleMessage(options) {
    const {
      messageId,
      phoneNumber,
      fromNumber,
      message,
      sendTime = 'immediately',
      reservationId,
      templateType,
      parkId,
      guestId,
      quietStart = '9:00 PM',
      quietEnd = '8:00 AM'
    } = options;

    const scheduleId = `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Calculate delay
    let delay = this.constructor.calculateDelay(sendTime);
    if (delay === null) {
      // For scheduled sends, store in DB for later processing
      this.storeScheduledMessage({
        scheduleId,
        phoneNumber,
        fromNumber,
        message,
        sendTime,
        reservationId,
        templateType,
        parkId,
        guestId,
        status: 'pending',
        createdAt: new Date()
      });
      return scheduleId;
    }

    // Skip quiet hours if necessary
    if (this.constructor.isQuietHours(quietStart, quietEnd)) {
      const nextWindow = this.calculateNextSendWindow(quietStart, quietEnd);
      delay = Math.max(delay, nextWindow);
    }

    // Store in-memory
    this.scheduledMessages.set(scheduleId, {
      phoneNumber,
      fromNumber,
      message,
      messageId,
      reservationId,
      templateType,
      parkId,
      guestId,
      scheduledAt: new Date()
    });

    // Set up timer
    const timer = setTimeout(() => {
      this.executeScheduledMessage(scheduleId);
    }, delay);

    this.activeTimers.set(scheduleId, timer);

    console.log(`[SMS] Scheduled message ${scheduleId} for delivery in ${Math.round(delay / 1000)}s`);

    return scheduleId;
  }

  /**
   * Calculate milliseconds until next send window (after quiet hours)
   */
  calculateNextSendWindow(quietStart, quietEnd) {
    const now = new Date();
    const end = this.constructor.parseTimeString(quietEnd);

    if (!end) return 0;

    let targetTime = new Date(now);
    targetTime.setHours(end.hours, end.minutes, 0, 0);

    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    return Math.max(0, targetTime - now);
  }

  /**
   * Store scheduled message in database for persistence
   */
  storeScheduledMessage(data) {
    try {
      const stmt = db.prepare(`
        INSERT INTO sms_scheduled (
          schedule_id, phone_number, from_number, message,
          send_time, reservation_id, template_type, park_id, guest_id,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        data.scheduleId,
        data.phoneNumber,
        data.fromNumber,
        data.message,
        data.sendTime,
        data.reservationId,
        data.templateType,
        data.parkId,
        data.guestId,
        'pending',
        new Date().toISOString()
      );
    } catch (error) {
      console.error('Error storing scheduled message:', error);
    }
  }

  /**
   * Execute a scheduled message
   */
  async executeScheduledMessage(scheduleId) {
    try {
      const message = this.scheduledMessages.get(scheduleId);
      if (!message) {
        console.warn(`No scheduled message found for ${scheduleId}`);
        return;
      }

      // Emit event to actual SMS sending (handled by SMS delivery API)
      console.log(`[SMS] Executing scheduled message ${scheduleId}`);

      // Update database
      this.updateScheduledMessageStatus(scheduleId, 'sent');

      // Cleanup
      this.scheduledMessages.delete(scheduleId);
      if (this.activeTimers.has(scheduleId)) {
        clearTimeout(this.activeTimers.get(scheduleId));
        this.activeTimers.delete(scheduleId);
      }
    } catch (error) {
      console.error(`Error executing scheduled message ${scheduleId}:`, error);
      this.updateScheduledMessageStatus(scheduleId, 'failed');
    }
  }

  /**
   * Update scheduled message status in database
   */
  updateScheduledMessageStatus(scheduleId, status) {
    try {
      const stmt = db.prepare(`
        UPDATE sms_scheduled
        SET status = ?, updated_at = ?
        WHERE schedule_id = ?
      `);

      stmt.run(status, new Date().toISOString(), scheduleId);
    } catch (error) {
      console.error('Error updating scheduled message status:', error);
    }
  }

  /**
   * Get scheduled messages
   */
  getScheduledMessages(status = null) {
    try {
      let query = 'SELECT * FROM sms_scheduled';
      const params = [];

      if (status) {
        query += ' WHERE status = ?';
        params.push(status);
      }

      query += ' ORDER BY send_time ASC';
      const stmt = db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Error fetching scheduled messages:', error);
      return [];
    }
  }

  /**
   * Cancel a scheduled message
   */
  cancelScheduledMessage(scheduleId) {
    try {
      const timer = this.activeTimers.get(scheduleId);
      if (timer) {
        clearTimeout(timer);
        this.activeTimers.delete(scheduleId);
      }

      this.scheduledMessages.delete(scheduleId);

      const stmt = db.prepare(`
        UPDATE sms_scheduled
        SET status = 'cancelled', updated_at = ?
        WHERE schedule_id = ?
      `);

      stmt.run(new Date().toISOString(), scheduleId);

      console.log(`[SMS] Cancelled scheduled message ${scheduleId}`);
      return true;
    } catch (error) {
      console.error('Error cancelling scheduled message:', error);
      return false;
    }
  }

  /**
   * Process pending scheduled messages (for recovery after restart)
   */
  async processPendingMessages() {
    try {
      const pending = this.getScheduledMessages('pending');

      for (const msg of pending) {
        const delay = this.constructor.calculateDelay(msg.send_time);
        if (delay !== null && delay >= 0) {
          this.scheduleMessage({
            messageId: msg.schedule_id,
            phoneNumber: msg.phone_number,
            fromNumber: msg.from_number,
            message: msg.message,
            sendTime: msg.send_time,
            reservationId: msg.reservation_id,
            templateType: msg.template_type,
            parkId: msg.park_id,
            guestId: msg.guest_id
          });
        }
      }

      console.log(`[SMS] Loaded ${pending.length} pending scheduled messages`);
    } catch (error) {
      console.error('Error processing pending messages:', error);
    }
  }

  /**
   * Cleanup - cancel all active timers
   */
  shutdown() {
    for (const [scheduleId, timer] of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.scheduledMessages.clear();
    console.log('[SMS] Scheduler shutdown complete');
  }
}

module.exports = SMSScheduler;
