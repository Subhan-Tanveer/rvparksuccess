/**
 * Admin OTA Management API
 *
 * Endpoints for managing OTA integrations:
 * - PUT /api/admin/ota/rates - Sync rates to connected OTAs
 * - GET /api/admin/ota/status - Get status of all connected OTAs
 * - GET /api/admin/ota/sync-logs - Get OTA sync history
 * - POST /api/admin/ota/connect - Connect a new OTA
 * - DELETE /api/admin/ota/disconnect - Disconnect an OTA
 *
 * All endpoints require staff authentication (same as other admin endpoints).
 */

import { AvailabilitySyncEngine } from '../../_lib/availability-sync.js';
import { OTAManager } from '../../_lib/ota-manager.js';
import * as store from '../../_lib/reservations-store.js';
import { verifyStaffSession } from '../../_lib/auth.js';

/**
 * Route handler
 */
export default async function handler(req, res) {
  // Verify staff session
  const staff = await verifyStaffSession(req, res);
  if (!staff) return; // verifyStaffSession handles the response

  const { method, query, body } = req;
  const { action } = query;

  try {
    switch (method) {
      case 'PUT':
        if (action === 'rates') {
          return await syncRates(staff.parkId, body, res);
        }
        break;

      case 'GET':
        if (action === 'status') {
          return await getOTAStatus(staff.parkId, res);
        }
        if (action === 'sync-logs') {
          return await getSyncLogs(staff.parkId, body, res);
        }
        break;

      case 'POST':
        if (action === 'connect') {
          return await connectOTA(staff.parkId, body, res);
        }
        break;

      case 'DELETE':
        if (action === 'disconnect') {
          return await disconnectOTA(staff.parkId, body, res);
        }
        break;
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('OTA admin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/admin/ota?action=rates
 *
 * Sync updated rates to connected OTAs
 *
 * Body:
 * {
 *   "rates": [
 *     { "date": "2026-08-15", "nightlyRateCents": 15000 },
 *     { "date": "2026-08-16", "nightlyRateCents": 15000 }
 *   ],
 *   "otasToSync": ["airbnb", "booking"], // Optional, defaults to all
 *   "siteId": "site-123" // Optional, if syncing specific site
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "otaResults": {
 *     "airbnb": { "success": true, "datesUpdated": 2 },
 *     "booking": { "success": false, "error": "API timeout" }
 *   }
 * }
 */
async function syncRates(parkId, body, res) {
  const { rates, otasToSync, siteId } = body;

  if (!Array.isArray(rates) || !rates.length) {
    return res.status(400).json({ error: 'Rates must be a non-empty array' });
  }

  // Validate rate format
  for (const rate of rates) {
    if (!rate.date || typeof rate.nightlyRateCents !== 'number') {
      return res.status(400).json({
        error: 'Each rate must include date and nightlyRateCents',
      });
    }
  }

  try {
    // Get park to verify it has OTA integrations
    const park = await store.getPark(parkId);
    if (!park) {
      return res.status(404).json({ error: 'Park not found' });
    }

    // Initialize OTA manager with park's credentials
    const otaManager = new OTAManager();
    const engine = new AvailabilitySyncEngine(store, otaManager);

    // Push rates to OTAs
    const result = await engine.pushRatesToOTAs(parkId, rates, otasToSync);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Rates synced to connected OTAs',
      syncId: result.syncId,
      ratesCount: result.ratesCount,
      otaResults: result.otaResults,
    });
  } catch (error) {
    console.error('Rate sync error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/admin/ota?action=status
 *
 * Get status of all connected OTA listings
 *
 * Response:
 * {
 *   "success": true,
 *   "listings": {
 *     "airbnb": {
 *       "connected": true,
 *       "listingId": "airbnb-123456",
 *       "status": "active",
 *       "rating": 4.85,
 *       "reviewCount": 42,
 *       "lastSyncAt": "2026-08-11T12:34:56Z"
 *     },
 *     "booking": {
 *       "connected": false
 *     }
 *   }
 * }
 */
async function getOTAStatus(parkId, res) {
  try {
    const park = await store.getPark(parkId);
    if (!park) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const otaManager = new OTAManager();

    const listingIds = {
      airbnb: park.airbnbListingId,
      booking: park.bookingListingId,
      vrbo: park.vrboListingId,
    };

    const statuses = await otaManager.getAllListingStatuses(listingIds);

    // Add last sync information
    const syncLogs = await getRecentSyncLogs(parkId);

    return res.status(200).json({
      success: true,
      listings: statuses,
      lastSyncs: syncLogs,
    });
  } catch (error) {
    console.error('OTA status error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/admin/ota?action=sync-logs
 *
 * Get OTA synchronization history
 *
 * Query:
 * {
 *   "limit": 50,
 *   "otaName": "airbnb", // Optional
 *   "syncType": "availability", // Optional: availability, booking-pull, rate-push
 *   "status": "success" // Optional: success, error
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "logs": [
 *     {
 *       "id": "log-123",
 *       "otaName": "airbnb",
 *       "syncType": "availability",
 *       "status": "success",
 *       "errorMsg": null,
 *       "syncedAt": "2026-08-11T12:30:00Z"
 *     }
 *   ]
 * }
 */
async function getSyncLogs(parkId, query, res) {
  const { limit = 50, otaName, syncType, status } = query;

  try {
    const logs = await fetchSyncLogs(parkId, {
      limit: Math.min(limit, 500),
      otaName,
      syncType,
      status,
    });

    return res.status(200).json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error) {
    console.error('Sync logs error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/admin/ota?action=connect
 *
 * Connect a new OTA platform
 *
 * Body:
 * {
 *   "otaName": "airbnb",
 *   "listingId": "airbnb-123456",
 *   "credentials": {
 *     "apiKey": "token_here",
 *     "apiUrl": "https://api.airbnb.com/partner/"
 *   }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Airbnb connected successfully"
 * }
 */
async function connectOTA(parkId, body, res) {
  const { otaName, listingId, credentials } = body;

  if (!otaName || !listingId || !credentials) {
    return res.status(400).json({
      error: 'Missing required fields: otaName, listingId, credentials',
    });
  }

  try {
    // Validate OTA name
    const validOTAs = ['airbnb', 'booking', 'vrbo'];
    if (!validOTAs.includes(otaName)) {
      return res.status(400).json({ error: `Unknown OTA: ${otaName}` });
    }

    // Initialize OTA and validate credentials
    const otaManager = new OTAManager();
    await otaManager.initializeOTA(otaName, credentials);

    // Store listing ID in park config
    const updateField = `${otaName}_listing_id`;
    await store.query(`UPDATE parks SET ${updateField} = $1 WHERE id = $2`, [
      listingId,
      parkId,
    ]);

    // Encrypt and store credentials securely
    // Note: In production, use proper encryption
    await store.query(
      `INSERT INTO ota_credentials (id, park_id, ota_name, credentials, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (park_id, ota_name) DO UPDATE SET credentials = $4, updated_at = now()`,
      [
        `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        parkId,
        otaName,
        JSON.stringify(credentials), // Should be encrypted in production
        new Date().toISOString(),
      ]
    );

    return res.status(200).json({
      success: true,
      message: `${otaName} connected successfully`,
      listingId,
    });
  } catch (error) {
    console.error('OTA connection error:', error);
    return res.status(400).json({ error: error.message });
  }
}

/**
 * DELETE /api/admin/ota?action=disconnect
 *
 * Disconnect an OTA platform
 *
 * Body:
 * {
 *   "otaName": "airbnb"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Airbnb disconnected successfully"
 * }
 */
async function disconnectOTA(parkId, body, res) {
  const { otaName } = body;

  if (!otaName) {
    return res.status(400).json({ error: 'Missing required field: otaName' });
  }

  try {
    const validOTAs = ['airbnb', 'booking', 'vrbo'];
    if (!validOTAs.includes(otaName)) {
      return res.status(400).json({ error: `Unknown OTA: ${otaName}` });
    }

    // Clear listing ID from park config
    const updateField = `${otaName}_listing_id`;
    await store.query(`UPDATE parks SET ${updateField} = NULL WHERE id = $1`, [parkId]);

    // Delete credentials
    await store.query(`DELETE FROM ota_credentials WHERE park_id = $1 AND ota_name = $2`, [
      parkId,
      otaName,
    ]);

    return res.status(200).json({
      success: true,
      message: `${otaName} disconnected successfully`,
    });
  } catch (error) {
    console.error('OTA disconnection error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Helper functions
 */

async function getRecentSyncLogs(parkId) {
  // Placeholder - in production would query ota_sync_logs table
  return {
    airbnb: null,
    booking: null,
    vrbo: null,
  };
}

async function fetchSyncLogs(parkId, filters) {
  // Placeholder - in production would query ota_sync_logs table with filters
  return [];
}
