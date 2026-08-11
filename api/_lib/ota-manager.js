/**
 * OTA Manager Module - Abstraction layer for Online Travel Agencies
 *
 * Provides a standardized interface for syncing with multiple OTA platforms:
 * - Airbnb
 * - Booking.com
 * - Vrbo
 *
 * Each OTA integration must implement:
 * - syncAvailability(listingId, parkId, dateRange)
 * - pullBookings(listingId)
 * - pushRates(listingId, rates)
 * - getListingStatus(listingId)
 * - validateCredentials()
 */

import AirbnbIntegration from './integrations/airbnb.js';
import BookingIntegration from './integrations/booking.js';
import VrboIntegration from './integrations/vrbo.js';

const INTEGRATIONS = {
  airbnb: AirbnbIntegration,
  booking: BookingIntegration,
  vrbo: VrboIntegration,
};

export class OTAManager {
  constructor() {
    this.integrations = {};
  }

  /**
   * Initialize an OTA integration with credentials
   */
  async initializeOTA(otaName, credentials) {
    if (!INTEGRATIONS[otaName]) {
      throw new Error(`Unknown OTA: ${otaName}`);
    }

    const IntegrationClass = INTEGRATIONS[otaName];
    const integration = new IntegrationClass(credentials);

    // Validate credentials before storing
    try {
      await integration.validateCredentials();
      this.integrations[otaName] = integration;
      return { success: true, message: `${otaName} initialized successfully` };
    } catch (error) {
      throw new Error(`Failed to validate ${otaName} credentials: ${error.message}`);
    }
  }

  /**
   * Get a specific OTA integration
   */
  getIntegration(otaName) {
    const integration = this.integrations[otaName];
    if (!integration) {
      throw new Error(`OTA ${otaName} not initialized. Please connect it first.`);
    }
    return integration;
  }

  /**
   * Sync availability to all connected OTAs
   * Returns standardized result format
   */
  async syncAvailabilityToAllOTAs(parkId, listingIds, dateRange) {
    const results = {};

    for (const otaName of Object.keys(INTEGRATIONS)) {
      if (!this.integrations[otaName]) continue; // Skip uninitialized OTAs

      try {
        const otaListingId = listingIds[otaName];
        if (!otaListingId) {
          results[otaName] = { success: false, error: 'No listing ID configured' };
          continue;
        }

        const integration = this.getIntegration(otaName);
        const result = await integration.syncAvailability(otaListingId, parkId, dateRange);

        results[otaName] = {
          success: true,
          message: `Availability synced for ${result.datesUpdated} dates`,
          datesUpdated: result.datesUpdated,
          syncedAt: new Date().toISOString(),
        };
      } catch (error) {
        results[otaName] = {
          success: false,
          error: error.message,
          syncedAt: new Date().toISOString(),
        };
      }
    }

    return results;
  }

  /**
   * Pull new bookings from all connected OTAs
   */
  async pullBookingsFromAllOTAs(parkId, listingIds) {
    const results = {};
    const allBookings = [];

    for (const otaName of Object.keys(INTEGRATIONS)) {
      if (!this.integrations[otaName]) continue;

      try {
        const otaListingId = listingIds[otaName];
        if (!otaListingId) continue;

        const integration = this.getIntegration(otaName);
        const bookings = await integration.pullBookings(otaListingId);

        results[otaName] = {
          success: true,
          bookingsCount: bookings.length,
          syncedAt: new Date().toISOString(),
        };

        allBookings.push(
          ...bookings.map((b) => ({
            ...b,
            otaName,
            otaListingId,
          }))
        );
      } catch (error) {
        results[otaName] = {
          success: false,
          error: error.message,
          syncedAt: new Date().toISOString(),
        };
      }
    }

    return { results, bookings: allBookings };
  }

  /**
   * Push updated rates to all connected OTAs
   */
  async pushRatesToAllOTAs(parkId, listingIds, rates) {
    const results = {};

    for (const otaName of Object.keys(INTEGRATIONS)) {
      if (!this.integrations[otaName]) continue;

      try {
        const otaListingId = listingIds[otaName];
        if (!otaListingId) {
          results[otaName] = { success: false, error: 'No listing ID configured' };
          continue;
        }

        const integration = this.getIntegration(otaName);
        const result = await integration.pushRates(otaListingId, rates);

        results[otaName] = {
          success: true,
          message: `Rates pushed for ${result.datesUpdated} dates`,
          datesUpdated: result.datesUpdated,
          syncedAt: new Date().toISOString(),
        };
      } catch (error) {
        results[otaName] = {
          success: false,
          error: error.message,
          syncedAt: new Date().toISOString(),
        };
      }
    }

    return results;
  }

  /**
   * Get listing status from an OTA
   */
  async getListingStatus(otaName, listingId) {
    const integration = this.getIntegration(otaName);
    const status = await integration.getListingStatus(listingId);
    return {
      otaName,
      listingId,
      ...status,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Get status of all connected OTA listings
   */
  async getAllListingStatuses(listingIds) {
    const results = {};

    for (const otaName of Object.keys(INTEGRATIONS)) {
      if (!this.integrations[otaName]) continue;

      try {
        const otaListingId = listingIds[otaName];
        if (!otaListingId) {
          results[otaName] = { connected: false };
          continue;
        }

        const status = await this.getListingStatus(otaName, otaListingId);
        results[otaName] = { connected: true, ...status };
      } catch (error) {
        results[otaName] = {
          connected: false,
          error: error.message,
        };
      }
    }

    return results;
  }

  /**
   * Check if an OTA is connected and configured
   */
  isOTAConnected(otaName) {
    return !!this.integrations[otaName];
  }

  /**
   * Get all connected OTAs
   */
  getConnectedOTAs() {
    return Object.keys(this.integrations);
  }
}

export default OTAManager;
