/**
 * Airbnb Integration Module
 *
 * Connects to Airbnb's Partner API to:
 * - Sync calendar availability (mark dates available/unavailable)
 * - Pull new bookings
 * - Update nightly rates
 * - Get listing health and reviews
 *
 * Requires:
 * - AIRBNB_API_KEY: OAuth access token (obtained via OAuth flow)
 * - AIRBNB_API_URL: https://api.airbnb.com/partner/
 *
 * Note: Actual API endpoints depend on Airbnb's current Partner API.
 * This implementation provides the framework; actual endpoints will be configured
 * once Airbnb credentials are obtained.
 */

import https from 'https';

class AirbnbIntegration {
  constructor(credentials) {
    if (!credentials.apiKey || !credentials.apiUrl) {
      throw new Error('Airbnb credentials must include apiKey and apiUrl');
    }

    this.apiKey = credentials.apiKey;
    this.apiUrl = credentials.apiUrl || 'https://api.airbnb.com/partner/';
    this.timeout = credentials.timeout || 30000;
    this.retryAttempts = credentials.retryAttempts || 3;
    this.retryDelayMs = credentials.retryDelayMs || 1000;
  }

  /**
   * Validate credentials by making a test API call
   */
  async validateCredentials() {
    try {
      const response = await this._makeRequest('GET', '/listings', {}, {
        Authorization: `Bearer ${this.apiKey}`,
      });
      if (response.error) {
        throw new Error(response.error.message || 'Invalid API credentials');
      }
      return { valid: true, message: 'Airbnb credentials validated' };
    } catch (error) {
      throw new Error(`Airbnb credential validation failed: ${error.message}`);
    }
  }

  /**
   * Sync availability - mark dates as available/unavailable on Airbnb
   * @param {string} listingId - Airbnb listing ID
   * @param {string} parkId - Our internal park ID
   * @param {object} dateRange - { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
   * @returns {object} - { datesUpdated: number, blockedDates: [], availableDates: [] }
   */
  async syncAvailability(listingId, parkId, dateRange) {
    const { startDate, endDate, blockedDates = [], availableDates = [] } = dateRange;

    if (!startDate || !endDate) {
      throw new Error('Date range must include startDate and endDate');
    }

    try {
      const payload = {
        listing_id: listingId,
        start_date: startDate,
        end_date: endDate,
        blocked_dates: blockedDates,
        available_dates: availableDates,
      };

      const response = await this._makeRequest(
        'PUT',
        `/listings/${listingId}/availability`,
        payload,
        this._getHeaders()
      );

      if (response.error) {
        throw new Error(`Airbnb API error: ${response.error.message}`);
      }

      return {
        datesUpdated: (blockedDates.length + availableDates.length),
        blockedDates,
        availableDates,
        response,
      };
    } catch (error) {
      throw new Error(`Failed to sync availability to Airbnb: ${error.message}`);
    }
  }

  /**
   * Pull new bookings from Airbnb since last sync
   * @param {string} listingId - Airbnb listing ID
   * @returns {array} - Array of booking objects
   */
  async pullBookings(listingId) {
    try {
      // Fetch recent reservations since a specific datetime
      const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const response = await this._makeRequest(
        'GET',
        `/listings/${listingId}/reservations?start_date=${sinceDate}`,
        {},
        this._getHeaders()
      );

      if (response.error) {
        throw new Error(`Airbnb API error: ${response.error.message}`);
      }

      const reservations = response.reservations || [];

      // Normalize Airbnb bookings to our standard format
      return reservations.map((booking) => this._normalizeAirbnbBooking(booking));
    } catch (error) {
      throw new Error(`Failed to pull bookings from Airbnb: ${error.message}`);
    }
  }

  /**
   * Update nightly rates on Airbnb
   * @param {string} listingId - Airbnb listing ID
   * @param {object} rates - { date: 'YYYY-MM-DD', nightlyRateCents: number }[]
   * @returns {object} - { datesUpdated: number }
   */
  async pushRates(listingId, rates) {
    if (!Array.isArray(rates) || !rates.length) {
      throw new Error('Rates must be a non-empty array');
    }

    try {
      // Group rates by date for bulk update
      const priceUpdates = rates.map((r) => ({
        date: r.date,
        price: r.nightlyRateCents / 100, // Convert cents to dollars
        currency: 'USD',
      }));

      const payload = {
        listing_id: listingId,
        price_updates: priceUpdates,
      };

      const response = await this._makeRequest(
        'PUT',
        `/listings/${listingId}/pricing`,
        payload,
        this._getHeaders()
      );

      if (response.error) {
        throw new Error(`Airbnb API error: ${response.error.message}`);
      }

      return {
        datesUpdated: priceUpdates.length,
        response,
      };
    } catch (error) {
      throw new Error(`Failed to push rates to Airbnb: ${error.message}`);
    }
  }

  /**
   * Get listing status - health, reviews, active status
   * @param {string} listingId - Airbnb listing ID
   * @returns {object} - { status, rating, reviewCount, responseRate, etc }
   */
  async getListingStatus(listingId) {
    try {
      const response = await this._makeRequest(
        'GET',
        `/listings/${listingId}`,
        {},
        this._getHeaders()
      );

      if (response.error) {
        throw new Error(`Airbnb API error: ${response.error.message}`);
      }

      const listing = response;

      return {
        listingId,
        status: listing.status || 'unknown',
        rating: listing.overall_rating || null,
        reviewCount: listing.review_count || 0,
        responseRate: listing.response_rate_percent || null,
        photoCount: listing.photos?.length || 0,
        instantBooking: listing.instant_bookable || false,
        superhost: listing.host_is_superhost || false,
      };
    } catch (error) {
      throw new Error(`Failed to get Airbnb listing status: ${error.message}`);
    }
  }

  /**
   * Normalize Airbnb booking format to our standard format
   * @private
   */
  _normalizeAirbnbBooking(booking) {
    return {
      otaBookingId: booking.id,
      guestName: booking.guest?.name || 'Guest',
      guestEmail: booking.guest?.email || '',
      guestPhone: booking.guest?.phone_number || '',
      checkIn: booking.start_date,
      checkOut: booking.end_date,
      nights: this._calculateNights(booking.start_date, booking.end_date),
      totalPriceCents: Math.round((booking.total_price || 0) * 100),
      currency: booking.currency || 'USD',
      status: booking.status,
      bookedAt: booking.created_at,
      paymentStatus: booking.payment_status || 'unknown',
    };
  }

  /**
   * Make HTTP request to Airbnb API with retry logic
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

        // Wait before retrying
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
      Authorization: `Bearer ${this.apiKey}`,
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

export default AirbnbIntegration;
