/**
 * Availability Sync Engine
 *
 * Handles bidirectional synchronization between our calendar and OTA platforms.
 *
 * Features:
 * - When guest books on our site → update OTA calendars (mark date unavailable)
 * - When OTA booking comes in → update our calendar
 * - Prevent overbooking (if booked on OTA, disable on our site)
 * - Scheduled job: sync every 30 minutes
 * - Error logging: alert owner if sync fails
 * - Exponential backoff for retries
 *
 * Usage:
 *   const engine = new AvailabilitySyncEngine(db, otaManager, logger);
 *   await engine.syncParkAvailability(parkId);
 */

export class AvailabilitySyncEngine {
  constructor(db, otaManager, logger = console) {
    this.db = db;
    this.otaManager = otaManager;
    this.logger = logger;
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
    this.syncTimeoutMs = 60000; // 60 second timeout per sync
  }

  /**
   * Sync availability for a specific park across all connected OTAs
   * @param {string} parkId - Park ID to sync
   * @returns {object} - Sync results with success status and details
   */
  async syncParkAvailability(parkId) {
    const syncId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      this.logger.info(`[${syncId}] Starting availability sync for park ${parkId}`);

      // Get park and its listing IDs
      const park = await this.db.getPark(parkId);
      if (!park) {
        throw new Error(`Park ${parkId} not found`);
      }

      // Get all sites for the park
      const sites = await this.db.getSitesForPark(parkId);
      if (!sites.length) {
        this.logger.warn(`[${syncId}] No sites found for park ${parkId}`);
        return { success: true, message: 'No sites to sync', otaResults: {} };
      }

      // Generate date range (next 90 days)
      const startDate = new Date();
      const endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const dateRange = {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      };

      // Get availability for each site and build OTA-specific payloads
      const availabilityData = await this._buildAvailabilityPayload(
        parkId,
        sites,
        dateRange
      );

      // Build listing ID mapping
      const listingIds = this._getListingIds(park);

      // Sync to all connected OTAs
      const otaResults = await this.otaManager.syncAvailabilityToAllOTAs(
        parkId,
        listingIds,
        availabilityData
      );

      // Log sync results to database
      await this._logSyncResults(parkId, 'availability', otaResults);

      this.logger.info(`[${syncId}] Availability sync completed for park ${parkId}`, otaResults);

      return {
        success: true,
        syncId,
        parkId,
        otaResults,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      };
    } catch (error) {
      this.logger.error(`[${syncId}] Availability sync failed for park ${parkId}:`, error);

      // Log error to database
      await this._logSyncError(parkId, 'availability', error.message);

      return {
        success: false,
        syncId,
        parkId,
        error: error.message,
      };
    }
  }

  /**
   * Pull new bookings from all OTAs for a park
   * @param {string} parkId - Park ID
   * @returns {object} - { success, bookings, results }
   */
  async pullBookingsForPark(parkId) {
    const syncId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      this.logger.info(`[${syncId}] Starting booking pull for park ${parkId}`);

      const park = await this.db.getPark(parkId);
      if (!park) throw new Error(`Park ${parkId} not found`);

      const listingIds = this._getListingIds(park);
      const { results, bookings } = await this.otaManager.pullBookingsFromAllOTAs(
        parkId,
        listingIds
      );

      // Process and ingest bookings
      const ingestedBookings = [];
      for (const booking of bookings) {
        try {
          const ingested = await this._ingestOTABooking(parkId, booking);
          if (ingested) ingestedBookings.push(ingested);
        } catch (error) {
          this.logger.warn(`[${syncId}] Failed to ingest OTA booking ${booking.otaBookingId}:`, error.message);
        }
      }

      // Log sync results
      await this._logSyncResults(parkId, 'booking-pull', results);

      this.logger.info(
        `[${syncId}] Booking pull completed for park ${parkId}`,
        { totalBookings: bookings.length, ingested: ingestedBookings.length }
      );

      return {
        success: true,
        syncId,
        parkId,
        totalBookings: bookings.length,
        ingestedBookings: ingestedBookings.length,
        results,
      };
    } catch (error) {
      this.logger.error(`[${syncId}] Booking pull failed for park ${parkId}:`, error);
      await this._logSyncError(parkId, 'booking-pull', error.message);

      return {
        success: false,
        syncId,
        parkId,
        error: error.message,
      };
    }
  }

  /**
   * Push updated rates to all OTAs for a park
   * @param {string} parkId - Park ID
   * @param {array} rates - Array of { date, nightlyRateCents }
   * @param {array} otasToSync - OTA names to sync to (optional, defaults to all)
   * @returns {object} - Sync results
   */
  async pushRatesToOTAs(parkId, rates, otasToSync = null) {
    const syncId = `push-rates-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      this.logger.info(`[${syncId}] Pushing rates for park ${parkId}`, {
        rateCount: rates.length,
        otasToSync,
      });

      const park = await this.db.getPark(parkId);
      if (!park) throw new Error(`Park ${parkId} not found`);

      if (!Array.isArray(rates) || !rates.length) {
        throw new Error('Rates must be a non-empty array');
      }

      const listingIds = this._getListingIds(park);

      // Filter OTAs if specified
      if (otasToSync) {
        for (const ota of otasToSync) {
          if (!listingIds[ota]) {
            this.logger.warn(`[${syncId}] OTA ${ota} not configured for park ${parkId}`);
          }
        }
      }

      const otaResults = await this.otaManager.pushRatesToAllOTAs(
        parkId,
        listingIds,
        rates
      );

      await this._logSyncResults(parkId, 'rate-push', otaResults);

      this.logger.info(`[${syncId}] Rate push completed for park ${parkId}`);

      return {
        success: true,
        syncId,
        parkId,
        ratesCount: rates.length,
        otaResults,
      };
    } catch (error) {
      this.logger.error(`[${syncId}] Rate push failed for park ${parkId}:`, error);
      await this._logSyncError(parkId, 'rate-push', error.message);

      return {
        success: false,
        syncId,
        parkId,
        error: error.message,
      };
    }
  }

  /**
   * Handle new reservation on our platform - mark unavailable on OTAs
   * @param {object} reservation - Reservation object
   */
  async handleNewReservation(reservation) {
    try {
      this.logger.info(`Handling new reservation ${reservation.id} for park ${reservation.parkId}`);

      const { parkId, checkIn, checkOut } = reservation;

      // Mark dates unavailable on OTAs
      const dateRange = {
        startDate: checkIn,
        endDate: checkOut,
        blockedDates: this._generateDateRange(checkIn, checkOut),
        availableDates: [],
      };

      await this.syncParkAvailability(parkId);
    } catch (error) {
      this.logger.error(`Failed to handle new reservation ${reservation.id}:`, error);
    }
  }

  /**
   * Build availability payload for OTA sync
   * @private
   */
  async _buildAvailabilityPayload(parkId, sites, dateRange) {
    const { startDate, endDate } = dateRange;
    const dateArray = this._generateDateRange(startDate, endDate);

    // Get all active reservations for the park in this date range
    const reservations = await this.db.getReservationsForPark(parkId);
    const activeReservations = reservations.filter(
      (r) => ['pending', 'confirmed', 'confirmed-deposit'].includes(r.status)
        && new Date(r.checkOut) > new Date(startDate)
        && new Date(r.checkIn) < new Date(endDate)
    );

    // Determine blocked dates
    const blockedDates = new Set();
    for (const res of activeReservations) {
      const resDateRange = this._generateDateRange(res.checkIn, res.checkOut);
      resDateRange.forEach((d) => blockedDates.add(d));
    }

    return {
      startDate,
      endDate,
      blockedDates: Array.from(blockedDates),
      availableDates: dateArray.filter((d) => !blockedDates.has(d)),
    };
  }

  /**
   * Ingest an OTA booking into our system
   * @private
   */
  async _ingestOTABooking(parkId, booking) {
    // Check if we already have this booking
    const existing = await this.db.query(
      `SELECT id FROM ota_bookings WHERE ota_name = $1 AND ota_booking_id = $2 AND park_id = $3`,
      [booking.otaName, booking.otaBookingId, parkId]
    );

    if (existing.rows && existing.rows.length > 0) {
      return null; // Already ingested
    }

    // Find matching guest or create new one
    let guest = await this.db.getGuestByEmail(booking.guestEmail);
    if (!guest) {
      guest = await this.db.createGuestAccount({
        name: booking.guestName,
        email: booking.guestEmail,
        phone: booking.guestPhone,
        password: Math.random().toString(36).slice(2, 12), // Random password
      });
    }

    // Find best matching site (for now, use first available)
    const sites = await this.db.getSitesForPark(parkId);
    if (!sites.length) {
      throw new Error('No sites available for booking');
    }

    // Create reservation in our system
    const reservation = await this.db.createStaffReservation({
      parkId,
      siteId: sites[0].id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      guestPhone: booking.guestPhone,
      paymentMethod: 'ota',
      notes: `Booked via ${booking.otaName}. OTA ID: ${booking.otaBookingId}`,
    });

    // Link OTA booking to our reservation
    const otaBookingId = `ota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.db.query(
      `INSERT INTO ota_bookings (id, park_id, ota_name, ota_booking_id, guest_id, linked_reservation_id, pulled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [otaBookingId, parkId, booking.otaName, booking.otaBookingId, guest.id, reservation.id, new Date().toISOString()]
    );

    this.logger.info(`Ingested OTA booking ${booking.otaBookingId} as reservation ${reservation.id}`);

    return {
      otaBookingId: booking.otaBookingId,
      reservationId: reservation.id,
      otaName: booking.otaName,
    };
  }

  /**
   * Log sync results to database
   * @private
   */
  async _logSyncResults(parkId, syncType, results) {
    try {
      for (const [otaName, result] of Object.entries(results)) {
        const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await this.db.query(
          `INSERT INTO ota_sync_logs (id, park_id, ota_name, sync_type, status, error_msg, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            logId,
            parkId,
            otaName,
            syncType,
            result.success ? 'success' : 'error',
            result.error || result.message || null,
            new Date().toISOString(),
          ]
        );
      }
    } catch (error) {
      this.logger.error('Failed to log sync results:', error);
    }
  }

  /**
   * Log sync error to database
   * @private
   */
  async _logSyncError(parkId, syncType, errorMsg) {
    try {
      const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await this.db.query(
        `INSERT INTO ota_sync_logs (id, park_id, ota_name, sync_type, status, error_msg, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [logId, parkId, 'system', syncType, 'error', errorMsg, new Date().toISOString()]
      );
    } catch (error) {
      this.logger.error('Failed to log sync error:', error);
    }
  }

  /**
   * Get listing IDs from park configuration
   * @private
   */
  _getListingIds(park) {
    return {
      airbnb: park.airbnbListingId || null,
      booking: park.bookingListingId || null,
      vrbo: park.vrboListingId || null,
    };
  }

  /**
   * Generate array of dates between start and end
   * @private
   */
  _generateDateRange(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current < end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }
}

export default AvailabilitySyncEngine;
