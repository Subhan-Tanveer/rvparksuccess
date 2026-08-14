/**
 * Twilio SMS Service
 * Handles all SMS communication with comprehensive error handling and rate limiting
 */

import https from 'https';
import querystring from 'querystring';

class TwilioSMSService {
  constructor(accountSid, authToken) {
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials (accountSid and authToken) are required');
    }
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
    this.rateLimitTracker = new Map();
    this.MAX_REQUESTS_PER_MINUTE = 60;
    this.RATE_LIMIT_WINDOW = 60000; // 1 minute in ms
  }

  /**
   * Check if request is within rate limit
   */
  checkRateLimit() {
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW;

    // Clean up old entries
    for (const [timestamp, _] of this.rateLimitTracker) {
      if (timestamp < windowStart) {
        this.rateLimitTracker.delete(timestamp);
      }
    }

    if (this.rateLimitTracker.size >= this.MAX_REQUESTS_PER_MINUTE) {
      const oldestTimestamp = Math.min(...Array.from(this.rateLimitTracker.keys()));
      const waitTime = oldestTimestamp + this.RATE_LIMIT_WINDOW - now;
      throw new Error(`Rate limit exceeded. Please retry in ${Math.ceil(waitTime / 1000)}s`);
    }

    this.rateLimitTracker.set(now, true);
  }

  /**
   * Make HTTP request to Twilio API
   */
  async makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'GRIT-RVPark-SMS/1.0'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 400) {
              reject({
                statusCode: res.statusCode,
                code: parsed.code,
                message: parsed.message,
                details: parsed
              });
            } else {
              resolve(parsed);
            }
          } catch (e) {
            if (res.statusCode >= 400) {
              reject({
                statusCode: res.statusCode,
                message: body || res.statusMessage
              });
            } else {
              resolve(body);
            }
          }
        });
      });

      req.on('error', (err) => {
        reject({
          statusCode: 0,
          message: 'Network error: ' + err.message,
          error: err
        });
      });

      if (data) {
        req.write(querystring.stringify(data));
      }
      req.end();
    });
  }

  /**
   * Send SMS message
   * @param {string} phoneNumber - Recipient phone number (E.164 format: +1234567890)
   * @param {string} fromNumber - Sender phone number (Twilio number)
   * @param {string} message - Message body (max 160 chars for single SMS, 153 for multipart)
   * @returns {Promise<{status: string, messageId: string, sentAt: string}>}
   */
  async sendSMS(phoneNumber, fromNumber, message) {
    try {
      this.checkRateLimit();

      // Validate inputs
      if (!phoneNumber || !fromNumber || !message) {
        throw new Error('phoneNumber, fromNumber, and message are required');
      }

      if (message.length > 1600) {
        throw new Error('Message exceeds maximum length (1600 characters)');
      }

      // Make request to Twilio
      const response = await this.makeRequest('POST', '/Messages.json', {
        To: phoneNumber,
        From: fromNumber,
        Body: message
      });

      return {
        status: 'queued', // Twilio returns 'queued' initially
        messageId: response.sid,
        sentAt: new Date().toISOString(),
        accountSid: response.account_sid,
        price: response.price
      };
    } catch (error) {
      return {
        status: 'failed',
        messageId: null,
        sentAt: new Date().toISOString(),
        error: error.message || error,
        errorCode: error.code || error.statusCode
      };
    }
  }

  /**
   * Send templated SMS with variable substitution
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} fromNumber - Sender phone number
   * @param {string} template - Message template with {{variable}} placeholders
   * @param {object} variables - Variables to substitute
   * @returns {Promise<{status: string, messageId: string, sentAt: string}>}
   */
  async sendTemplatedSMS(phoneNumber, fromNumber, template, variables = {}) {
    try {
      let message = template;

      // Replace all {{variable}} placeholders
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        message = message.replace(new RegExp(placeholder, 'g'), value || '');
      }

      return await this.sendSMS(phoneNumber, fromNumber, message);
    } catch (error) {
      return {
        status: 'failed',
        messageId: null,
        sentAt: new Date().toISOString(),
        error: error.message || error
      };
    }
  }

  /**
   * Get message status from Twilio
   * @param {string} messageSid - Twilio message SID
   * @returns {Promise<{status: string, errorCode?: string, errorMessage?: string}>}
   */
  async getMessageStatus(messageSid) {
    try {
      const response = await this.makeRequest('GET', `/Messages/${messageSid}.json`);
      return {
        status: response.status, // sent, delivered, failed, undelivered, etc.
        errorCode: response.error_code || null,
        errorMessage: response.error_message || null,
        dateCreated: response.date_created,
        dateSent: response.date_sent,
        dateUpdated: response.date_updated,
        price: response.price,
        priceUnit: response.price_unit
      };
    } catch (error) {
      return {
        status: 'unknown',
        error: error.message || error,
        errorCode: error.code
      };
    }
  }

  /**
   * Verify phone number format (E.164)
   */
  static validatePhoneNumber(phoneNumber) {
    const e164Regex = /^\+?[1-9]\d{1,14}$/;
    return e164Regex.test(phoneNumber.replace(/\D/g, ''));
  }

  /**
   * Format phone number to E.164
   */
  static formatPhoneNumber(phoneNumber, countryCode = '1') {
    // Remove all non-digits
    const cleaned = phoneNumber.replace(/\D/g, '');

    // Add country code if not present
    if (cleaned.length === 10) {
      return `+${countryCode}${cleaned}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
      return `+${cleaned}`;
    } else if (!cleaned.startsWith(countryCode)) {
      return `+${countryCode}${cleaned}`;
    }
    return `+${cleaned}`;
  }
}

export default TwilioSMSService;
