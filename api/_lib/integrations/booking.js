/**
 * Booking.com Integration Module
 *
 * Connects to Booking.com's Extranet API to:
 * - Sync calendar availability
 * - Pull new bookings
 * - Update nightly rates
 * - Get property status
 *
 * Requires:
 * - BOOKING_ACCOUNT_ID: Booking.com account ID
 * - BOOKING_API_KEY: API credentials token
 * - BOOKING_API_URL: https://api.booking.com/
 *
 * Note: Booking.com has different API structure than Airbnb.
 * Uses property/unit terminology instead of listings.
 */

import https from 'https';

class BookingIntegration {
  constructor(credentials) {
    if (!credentials.accountId || !credentials.apiKey) {
      throw new Error('Booking.com credentials must include accountId and apiKey');
    }

    this.accountId = credentials.accountId;
    this.apiKey = credentials.apiKey;
    this.apiUrl = credentials.apiUrl || 'https://secure-supply-api.booking.com/api/';
    this.timeout = credentials.timeout || 30000;
    this.retryAttempts = credentials.retryAttempts || 3;
    this.retryDelayMs = credentials.retryDelayMs || 1000;
  }

  /**
   * Validate credentials by making a test API call
   */
  async validateCredentials() {
    try {
      const response = await this._makeRequest('GET', '/property', {}, this._getHeaders());

      if (response.error || !response.success) {
        throw new Error(response.error?.message || 'Invalid API credentials');
      }

      return { valid: true, message: 'Booking.com credentials validated' };
    } catch (error) {
      throw new Error(`Booking.com credential validation failed: ${error.message}`);
    }
  }

  /**
   * Sync availability - update Booking.com calendar
   * @param {string} propertyId - Booking.com property ID
   * @param {string} parkId - Our internal park ID
   * @param {object} dateRange - { startDate, endDate, blockedDates, availableDates }
   * @returns {object} - { datesUpdated: number }
   */
  async syncAvailability(propertyId, parkId, dateRange) {
    const { startDate, endDate, blockedDates = [], availableDates = [] } = dateRange;

    if (!startDate || !endDate) {
      throw new Error('Date range must include startDate and endDate');
    }

    try {
      // Booking.com uses different endpoint structure
      // POST to availability endpoint with date ranges
      const payload = {
        property_id: propertyId,
        start_date: startDate,
        end_date: endDate,
        blocked_dates: blockedDates,
        available_dates: availableDates,
      };

      const response = await this._makeRequest(
        'POST',
        '/property/calendar/availability',
        payload,
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Unknown error updating availability');
      }

      return {
        datesUpdated: (blockedDates.length + availableDates.length),
        blockedDates,
        availableDates,
      };
    } catch (error) {
      throw new Error(`Failed to sync availability to Booking.com: ${error.message}`);
    }
  }

  /**
   * Pull new bookings from Booking.com
   * @param {string} propertyId - Booking.com property ID
   * @returns {array} - Array of normalized booking objects
   */
  async pullBookings(propertyId) {
    try {
      // Fetch recent reservations (last 24 hours by default)
      const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sinceDateStr = sinceDate.toISOString().split('T')[0];

      const response = await this._makeRequest(
        'GET',
        `/property/${propertyId}/bookings?start_date=${sinceDateStr}`,
        {},
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch bookings');
      }

      const bookings = response.bookings || [];

      return bookings.map((booking) => this._normalizeBookingComBooking(booking));
    } catch (error) {
      throw new Error(`Failed to pull bookings from Booking.com: ${error.message}`);
    }
  }

  /**
   * Update nightly rates on Booking.com
   * @param {string} propertyId - Booking.com property ID
   * @param {array} rates - Array of { date, nightlyRateCents }
   * @returns {object} - { datesUpdated: number }
   */
  async pushRates(propertyId, rates) {
    if (!Array.isArray(rates) || !rates.length) {
      throw new Error('Rates must be a non-empty array');
    }

    try {
      // Booking.com expects rates in a specific format
      const priceUpdates = rates.map((r) => ({
        date: r.date,
        gross_price: r.nightlyRateCents / 100, // Convert cents to dollars
        currency: 'USD',
      }));

      const payload = {
        property_id: propertyId,
        price_updates: priceUpdates,
      };

      const response = await this._makeRequest(
        'PUT',
        `/property/${propertyId}/pricing`,
        payload,
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update pricing');
      }

      return {
        datesUpdated: priceUpdates.length,
      };
    } catch (error) {
      throw new Error(`Failed to push rates to Booking.com: ${error.message}`);
    }
  }

  /**
   * Get property status
   * @param {string} propertyId - Booking.com property ID
   * @returns {object} - Property status details
   */
  async getListingStatus(propertyId) {
    try {
      const response = await this._makeRequest(
        'GET',
        `/property/${propertyId}`,
        {},
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch property status');
      }

      const property = response.property;

      return {
        listingId: propertyId,
        status: property.status || 'unknown',
        rating: property.review_score || null,
        reviewCount: property.reviews_count || 0,
        responseRate: property.response_rate || null,
        photoCount: property.photos?.length || 0,
        instantBooking: property.instant_confirmable || false,
        preferredPartner: property.preferred_partner || false,
      };
    } catch (error) {
      throw new Error(`Failed to get Booking.com property status: ${error.message}`);
    }
  }

  /**
   * Normalize Booking.com booking format to our standard
   * @private
   */
  _normalizeBookingComBooking(booking) {
    return {
      otaBookingId: booking.id,
      guestName: booking.guest_name || 'Guest',
      guestEmail: booking.guest_email || '',
      guestPhone: booking.guest_phone || '',
      checkIn: booking.checkin,
      checkOut: booking.checkout,
      nights: booking.length_of_stay || this._calculateNights(booking.checkin, booking.checkout),
      totalPriceCents: Math.round((booking.total_price || 0) * 100),
      currency: booking.currency || 'USD',
      status: this._mapBookingStatus(booking.status),
      bookedAt: booking.creation_date,
      paymentStatus: booking.payment_status || 'unknown',
    };
  }

  /**
   * Map Booking.com status to standard status
   * @private
   */
  _mapBookingStatus(bookingComStatus) {
    const statusMap = {
      'new': 'confirmed',
      'confirmed': 'confirmed',
      'cancelled': 'canceled',
      'cancelled_by_guest': 'canceled',
      'cancelled_by_property': 'canceled',
      'pending_confirmation': 'pending',
      'no_show': 'no-show',
    };
    return statusMap[bookingComStatus] || 'unknown';
  }

  /**
   * Make HTTP request with retry logic
   * @private
   */
  async _makeRequest(method, endpoint, body = {}, headers = {}) {
    let lastError;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        return await this._performRequest(method, endpoint, body, headers);
      } catch (error) {
        lastError = error;

        // Don't retry on 4xx errors
        if (error.statusCode && error.statusCode < 500) {
          throw error;
        }

        // Wait before retrying with exponential backoff
        if (attempt < this.retryAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs * Math.pow(2, attempt))
          );
        }
      }
    }

    throw new Error(`Request failed after ${this.retryAttempts} attempts: ${lastError.message}`);
  }

  /**
   * Perform single HTTP request
   * @private
   */
  _performRequest(method, endpoint, body = {}, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiUrl + endpoint);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...headers,
        },
        timeout: this.timeout,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              const error = new Error(parsed.message || `HTTP ${res.statusCode}`);
              error.statusCode = res.statusCode;
              error.response = parsed;
              reject(error);
            } else {
              resolve(parsed);
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (method !== 'GET' && Object.keys(body).length > 0) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Get authorization headers
   * @private
   */
  _getHeaders() {
    return {
      'X-Booking-Account-ID': this.accountId,
      'X-Booking-API-Key': this.apiKey,
    };
  }

  /**
   * Calculate nights between two dates
   * @private
   */
  _calculateNights(checkIn, checkOut) {
    const ms = new Date(checkOut) - new Date(checkIn);
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }
}

export default BookingIntegration;
