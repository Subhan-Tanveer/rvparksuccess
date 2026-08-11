/**
 * Vrbo Integration Module
 *
 * Connects to Vrbo's (Vacation Rental by Owner) API to:
 * - Sync calendar availability
 * - Pull new bookings
 * - Update nightly rates
 * - Get rental property status
 *
 * Vrbo is part of the Expedia Group and uses their partner API framework.
 *
 * Requires:
 * - VRBO_PARTNER_ID: Vrbo partner account ID
 * - VRBO_API_KEY: API key for authentication
 * - VRBO_API_URL: https://api.vrbo.com/
 */

import https from 'https';

class VrboIntegration {
  constructor(credentials) {
    if (!credentials.partnerId || !credentials.apiKey) {
      throw new Error('Vrbo credentials must include partnerId and apiKey');
    }

    this.partnerId = credentials.partnerId;
    this.apiKey = credentials.apiKey;
    this.apiUrl = credentials.apiUrl || 'https://api.vrbo.com/partner/';
    this.timeout = credentials.timeout || 30000;
    this.retryAttempts = credentials.retryAttempts || 3;
    this.retryDelayMs = credentials.retryDelayMs || 1000;
  }

  /**
   * Validate credentials
   */
  async validateCredentials() {
    try {
      const response = await this._makeRequest('GET', '/rentals', {}, this._getHeaders());

      if (response.error || !response.success) {
        throw new Error(response.error?.message || 'Invalid API credentials');
      }

      return { valid: true, message: 'Vrbo credentials validated' };
    } catch (error) {
      throw new Error(`Vrbo credential validation failed: ${error.message}`);
    }
  }

  /**
   * Sync availability to Vrbo
   * @param {string} rentalId - Vrbo rental property ID
   * @param {string} parkId - Our internal park ID
   * @param {object} dateRange - { startDate, endDate, blockedDates, availableDates }
   * @returns {object} - { datesUpdated: number }
   */
  async syncAvailability(rentalId, parkId, dateRange) {
    const { startDate, endDate, blockedDates = [], availableDates = [] } = dateRange;

    if (!startDate || !endDate) {
      throw new Error('Date range must include startDate and endDate');
    }

    try {
      const payload = {
        rental_id: rentalId,
        start_date: startDate,
        end_date: endDate,
        blocked_dates: blockedDates,
        available_dates: availableDates,
      };

      const response = await this._makeRequest(
        'PUT',
        `/rentals/${rentalId}/calendar`,
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
      throw new Error(`Failed to sync availability to Vrbo: ${error.message}`);
    }
  }

  /**
   * Pull new bookings from Vrbo
   * @param {string} rentalId - Vrbo rental property ID
   * @returns {array} - Array of normalized booking objects
   */
  async pullBookings(rentalId) {
    try {
      // Fetch recent reservations
      const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sinceDateStr = sinceDate.toISOString().split('T')[0];

      const response = await this._makeRequest(
        'GET',
        `/rentals/${rentalId}/reservations?start_date=${sinceDateStr}`,
        {},
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch bookings');
      }

      const reservations = response.reservations || [];

      return reservations.map((booking) => this._normalizeVrboBooking(booking));
    } catch (error) {
      throw new Error(`Failed to pull bookings from Vrbo: ${error.message}`);
    }
  }

  /**
   * Update nightly rates on Vrbo
   * @param {string} rentalId - Vrbo rental property ID
   * @param {array} rates - Array of { date, nightlyRateCents }
   * @returns {object} - { datesUpdated: number }
   */
  async pushRates(rentalId, rates) {
    if (!Array.isArray(rates) || !rates.length) {
      throw new Error('Rates must be a non-empty array');
    }

    try {
      const priceUpdates = rates.map((r) => ({
        date: r.date,
        nightly_rate: r.nightlyRateCents / 100, // Convert cents to dollars
        currency: 'USD',
      }));

      const payload = {
        rental_id: rentalId,
        rate_updates: priceUpdates,
      };

      const response = await this._makeRequest(
        'PUT',
        `/rentals/${rentalId}/rates`,
        payload,
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update rates');
      }

      return {
        datesUpdated: priceUpdates.length,
      };
    } catch (error) {
      throw new Error(`Failed to push rates to Vrbo: ${error.message}`);
    }
  }

  /**
   * Get rental status
   * @param {string} rentalId - Vrbo rental property ID
   * @returns {object} - Rental status details
   */
  async getListingStatus(rentalId) {
    try {
      const response = await this._makeRequest(
        'GET',
        `/rentals/${rentalId}`,
        {},
        this._getHeaders()
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch rental status');
      }

      const rental = response.rental;

      return {
        listingId: rentalId,
        status: rental.status || 'unknown',
        rating: rental.rating || null,
        reviewCount: rental.review_count || 0,
        responseRate: rental.response_rate || null,
        photoCount: rental.photos?.length || 0,
        instantBooking: rental.instant_bookable || false,
        vrboChoice: rental.vrbo_choice || false,
      };
    } catch (error) {
      throw new Error(`Failed to get Vrbo rental status: ${error.message}`);
    }
  }

  /**
   * Normalize Vrbo booking to standard format
   * @private
   */
  _normalizeVrboBooking(booking) {
    return {
      otaBookingId: booking.id,
      guestName: booking.guest_name || 'Guest',
      guestEmail: booking.guest_email || '',
      guestPhone: booking.guest_phone || '',
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      nights: booking.nights || this._calculateNights(booking.check_in, booking.check_out),
      totalPriceCents: Math.round((booking.total_price || 0) * 100),
      currency: booking.currency || 'USD',
      status: this._mapVrboStatus(booking.status),
      bookedAt: booking.booked_at,
      paymentStatus: booking.payment_status || 'unknown',
    };
  }

  /**
   * Map Vrbo status to standard status
   * @private
   */
  _mapVrboStatus(vrboStatus) {
    const statusMap = {
      'confirmed': 'confirmed',
      'pending': 'pending',
      'cancelled': 'canceled',
      'completed': 'completed',
      'no_show': 'no-show',
      'checked_in': 'checked-in',
      'checked_out': 'checked-out',
    };
    return statusMap[vrboStatus] || 'unknown';
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

        // Don't retry on 4xx errors (bad request, auth, etc)
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
      'X-Vrbo-Partner-ID': this.partnerId,
      'X-Vrbo-API-Key': this.apiKey,
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

export default VrboIntegration;
