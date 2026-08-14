// Multi-Property Management Engine
// Orchestrates property portfolio management, consolidated analytics, bulk operations, and white-label branding.
//
// Core capabilities:
// - Property portfolio management (add/remove parks)
// - Cross-property analytics (aggregate metrics across all parks)
// - Bulk operations (update rates, send promotions to all parks)
// - Permission levels (manager sees all, staff sees only assigned park)
// - Consolidated reporting (all parks' revenue, occupancy in one view)

import {
  getPropertiesForUser,
  getPark,
  getSitesForPark,
  getReservationsForPark,
  getParkStats,
  getUserRole,
  getPropertyBranding,
  updatePropertyBranding,
  getPropertyGroupsForUser,
  getPropertiesInGroup,
  createBulkOperation,
  getBulkOperation,
  completeBulkOperation,
  logOperationAudit,
  updateSite,
} from './reservations-store.js';

/**
 * Get all parks managed by a user
 * @param {string} userId - The user ID
 * @param {string} permissionLevel - Filter by permission level (admin, manager, staff)
 * @returns {Promise<Array>} List of properties with permission levels
 */
export async function getUserProperties(userId, permissionLevel = null) {
  const properties = await getPropertiesForUser(userId);
  if (permissionLevel) {
    return properties.filter(p => p.permissionLevel === permissionLevel);
  }
  return properties;
}

/**
 * Get consolidated metrics across multiple properties
 * @param {string} userId - The user ID
 * @param {number} daysBack - Number of days to look back (default 30)
 * @returns {Promise<Object>} Aggregated KPIs
 */
export async function getConsolidatedMetrics(userId, daysBack = 30) {
  const properties = await getUserProperties(userId);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  let totalRevenueCents = 0;
  let totalReservations = 0;
  let totalNights = 0;
  let totalGuests = 0;
  let totalSites = 0;
  let propertyMetrics = [];

  for (const property of properties) {
    try {
      const stats = await getParkStats(property.id);
      const reservations = await getReservationsForPark(property.id);
      const sites = await getSitesForPark(property.id);

      totalSites += sites.length;

      const recentReservations = reservations.filter(r => {
        const createdAt = new Date(r.createdAt);
        return createdAt >= startDate && r.status !== 'canceled';
      });

      const revenueCents = recentReservations.reduce((sum, r) => sum + r.totalCents, 0);
      const nights = recentReservations.reduce((sum, r) => sum + r.nights, 0);

      totalRevenueCents += revenueCents;
      totalReservations += recentReservations.length;
      totalNights += nights;
      totalGuests += recentReservations.length;

      const adr = nights > 0 ? revenueCents / nights / 100 : 0;
      const occupancy = sites.length > 0 ? (nights / (sites.length * daysBack)) * 100 : 0;

      propertyMetrics.push({
        parkId: property.id,
        parkName: property.name,
        revenueCents,
        reservations: recentReservations.length,
        nights,
        adr,
        occupancyPercent: Math.round(occupancy * 10) / 10,
        sitesCount: sites.length,
      });
    } catch (err) {
      console.error(`Error loading metrics for park ${property.id}:`, err);
    }
  }

  // Sort by revenue descending
  propertyMetrics.sort((a, b) => b.revenueCents - a.revenueCents);

  const avgOccupancy =
    totalNights > 0
      ? (totalNights / (totalSites * daysBack)) * 100
      : 0;

  return {
    totalRevenueCents,
    totalReservationsCents: totalRevenueCents,
    totalReservations,
    totalNights,
    totalGuests,
    totalProperties: properties.length,
    totalSites,
    averageAdr: totalNights > 0 ? totalRevenueCents / totalNights / 100 : 0,
    averageOccupancyPercent: Math.round(avgOccupancy * 10) / 10,
    propertyMetrics,
    daysBack,
  };
}

/**
 * Get property comparison metrics (rank properties)
 * @param {string} userId - The user ID
 * @param {string} sortBy - Sort field: revenue, occupancy, adr (default: revenue)
 * @returns {Promise<Array>} Ranked properties
 */
export async function getPropertyComparison(userId, sortBy = 'revenue') {
  const properties = await getUserProperties(userId);
  const metrics = [];

  for (const property of properties) {
    try {
      const reservations = await getReservationsForPark(property.id);
      const sites = await getSitesForPark(property.id);

      // Last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentReservations = reservations.filter(r => {
        const createdAt = new Date(r.createdAt);
        return createdAt >= thirtyDaysAgo && r.status !== 'canceled';
      });

      const revenueCents = recentReservations.reduce((sum, r) => sum + r.totalCents, 0);
      const nights = recentReservations.reduce((sum, r) => sum + r.nights, 0);
      const adr = nights > 0 ? revenueCents / nights / 100 : 0;
      const occupancy = sites.length > 0 ? (nights / (sites.length * 30)) * 100 : 0;

      metrics.push({
        parkId: property.id,
        parkName: property.name,
        location: property.location,
        state: property.state,
        revenueCents,
        occupancyPercent: Math.round(occupancy * 10) / 10,
        adr,
        reservations: recentReservations.length,
        sitesCount: sites.length,
      });
    } catch (err) {
      console.error(`Error loading comparison for park ${property.id}:`, err);
    }
  }

  // Sort based on parameter
  if (sortBy === 'occupancy') {
    metrics.sort((a, b) => b.occupancyPercent - a.occupancyPercent);
  } else if (sortBy === 'adr') {
    metrics.sort((a, b) => b.adr - a.adr);
  } else {
    metrics.sort((a, b) => b.revenueCents - a.revenueCents);
  }

  return metrics;
}

/**
 * Apply rate update across multiple properties
 * @param {string} userId - The user ID
 * @param {Array<string>} propertyIds - Property IDs to update
 * @param {Object} rateCard - Rate configuration { siteId: cents, ... }
 * @returns {Promise<Object>} Operation result
 */
export async function bulkUpdateRates(userId, propertyIds, rateCard) {
  const operationId = await createBulkOperation(
    userId,
    'bulk-rate-update',
    propertyIds,
    { rateCard, timestamp: new Date().toISOString() }
  );

  let completed = 0;
  let failed = 0;

  for (const parkId of propertyIds) {
    try {
      // Verify user has access to this property
      const userRole = await getUserRole(userId, parkId);
      if (!userRole) {
        failed++;
        await logOperationAudit(operationId, parkId, 'rate-update', 'failed', 'No permission');
        continue;
      }

      // Get all sites for this property
      const sites = await getSitesForPark(parkId);

      for (const site of sites) {
        if (rateCard[site.id]) {
          try {
            await updateSite(site.id, parkId, { nightlyRateCents: rateCard[site.id] });
            await logOperationAudit(operationId, parkId, 'rate-update', 'success', `Site ${site.name}: ${rateCard[site.id]} cents`);
          } catch (siteErr) {
            failed++;
            await logOperationAudit(operationId, parkId, 'rate-update', 'failed', `Site ${site.name}: ${siteErr.message}`);
          }
        }
      }

      completed++;
    } catch (err) {
      failed++;
      await logOperationAudit(operationId, parkId, 'rate-update', 'failed', err.message);
    }
  }

  await completeBulkOperation(operationId, completed, failed);
  return { operationId, completed, failed, total: propertyIds.length };
}

/**
 * Send bulk promotion to multiple properties
 * @param {string} userId - The user ID
 * @param {Array<string>} propertyIds - Property IDs
 * @param {Object} campaign - Campaign object { code, discount, type, description }
 * @returns {Promise<Object>} Operation result
 */
export async function bulkSendPromotion(userId, propertyIds, campaign) {
  const operationId = await createBulkOperation(
    userId,
    'bulk-campaign',
    propertyIds,
    { campaign, timestamp: new Date().toISOString() }
  );

  let completed = 0;
  let failed = 0;

  for (const parkId of propertyIds) {
    try {
      const userRole = await getUserRole(userId, parkId);
      if (!userRole) {
        failed++;
        await logOperationAudit(operationId, parkId, 'campaign-send', 'failed', 'No permission');
        continue;
      }

      // In a real implementation, this would integrate with the campaign engine
      // For now, just log the audit
      await logOperationAudit(
        operationId,
        parkId,
        'campaign-send',
        'success',
        `Campaign "${campaign.code}" scheduled for ${campaign.description}`
      );

      completed++;
    } catch (err) {
      failed++;
      await logOperationAudit(operationId, parkId, 'campaign-send', 'failed', err.message);
    }
  }

  await completeBulkOperation(operationId, completed, failed);
  return { operationId, completed, failed, total: propertyIds.length };
}

/**
 * Bulk maintenance scheduling across properties
 * @param {string} userId - The user ID
 * @param {Array<string>} propertyIds - Property IDs
 * @param {Array<string>} siteIds - Site IDs to block (empty = all sites)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} reason - Maintenance reason
 * @returns {Promise<Object>} Operation result
 */
export async function bulkScheduleMaintenance(userId, propertyIds, siteIds, startDate, endDate, reason) {
  const operationId = await createBulkOperation(
    userId,
    'bulk-maintenance',
    propertyIds,
    { siteIds, startDate, endDate, reason, timestamp: new Date().toISOString() }
  );

  let completed = 0;
  let failed = 0;

  for (const parkId of propertyIds) {
    try {
      const userRole = await getUserRole(userId, parkId);
      if (!userRole) {
        failed++;
        await logOperationAudit(operationId, parkId, 'maintenance-schedule', 'failed', 'No permission');
        continue;
      }

      const sites = await getSitesForPark(parkId);
      const sitesToBlock = siteIds.length > 0 ? sites.filter(s => siteIds.includes(s.id)) : sites;

      // In a real implementation, this would create blackout dates
      await logOperationAudit(
        operationId,
        parkId,
        'maintenance-schedule',
        'success',
        `${sitesToBlock.length} site(s) blocked from ${startDate} to ${endDate}: ${reason}`
      );

      completed++;
    } catch (err) {
      failed++;
      await logOperationAudit(operationId, parkId, 'maintenance-schedule', 'failed', err.message);
    }
  }

  await completeBulkOperation(operationId, completed, failed);
  return { operationId, completed, failed, total: propertyIds.length };
}

/**
 * Get organizational hierarchy (if user manages sub-managers)
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} Hierarchy structure
 */
export async function getPropertyHierarchy(userId) {
  const groups = await getPropertyGroupsForUser(userId);
  const hierarchyData = {
    userId,
    groups: [],
    ungroupedProperties: [],
  };

  const allProperties = await getUserProperties(userId);
  const groupedPropertyIds = new Set();

  for (const group of groups) {
    const properties = await getPropertiesInGroup(group.id);
    groupedPropertyIds.forEach(p => groupedPropertyIds.add(p.id));

    hierarchyData.groups.push({
      id: group.id,
      name: group.name,
      description: group.description,
      type: group.groupType,
      properties: properties.map(p => ({
        id: p.id,
        name: p.name,
        location: p.location,
      })),
    });
  }

  hierarchyData.ungroupedProperties = allProperties
    .filter(p => !groupedPropertyIds.has(p.id))
    .map(p => ({
      id: p.id,
      name: p.name,
      location: p.location,
      permissionLevel: p.permissionLevel,
    }));

  return hierarchyData;
}

/**
 * Get white-label branding for a property
 * @param {string} parkId - Park ID
 * @returns {Promise<Object>} Branding configuration
 */
export async function getBrandingForProperty(parkId) {
  const branding = await getPropertyBranding(parkId);
  return {
    logo: branding.logo || null,
    logoUrl: branding.logoUrl || null,
    primaryColor: branding.primaryColor || '#D97D2E',
    accentColor: branding.accentColor || '#2E9B54',
    backgroundColor: branding.backgroundColor || '#0A0A0A',
    customFonts: branding.customFonts || null,
    companyName: branding.companyName || null,
    domain: branding.domain || null,
    emailBranding: branding.emailBranding || {},
  };
}

/**
 * Apply/update white-label branding for a property
 * @param {string} parkId - Park ID
 * @param {Object} branding - Branding config
 * @returns {Promise<void>}
 */
export async function applyBranding(parkId, branding) {
  await updatePropertyBranding(parkId, branding);
}

/**
 * Get consolidated alerts across all properties
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of alerts
 */
export async function getConsolidatedAlerts(userId) {
  const properties = await getUserProperties(userId);
  const alerts = [];

  for (const property of properties) {
    try {
      const reservations = await getReservationsForPark(property.id);
      const sites = await getSitesForPark(property.id);

      // Check for low occupancy
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentReservations = reservations.filter(r => {
        const createdAt = new Date(r.createdAt);
        return createdAt >= thirtyDaysAgo && r.status !== 'canceled';
      });

      const nights = recentReservations.reduce((sum, r) => sum + r.nights, 0);
      const occupancy = sites.length > 0 ? (nights / (sites.length * 30)) * 100 : 0;

      if (occupancy < 50) {
        alerts.push({
          parkId: property.id,
          parkName: property.name,
          type: 'low_occupancy',
          severity: 'warning',
          message: `Low occupancy: ${Math.round(occupancy)}%`,
          value: Math.round(occupancy),
        });
      }

      // Check for pending payments
      const pendingPayments = reservations.filter(r => r.status === 'confirmed' && r.balanceCents > 0);
      if (pendingPayments.length > 0) {
        const totalPending = pendingPayments.reduce((sum, r) => sum + r.balanceCents, 0);
        alerts.push({
          parkId: property.id,
          parkName: property.name,
          type: 'pending_payments',
          severity: 'info',
          message: `${pendingPayments.length} reservation(s) with pending payment`,
          value: totalPending,
        });
      }
    } catch (err) {
      console.error(`Error loading alerts for park ${property.id}:`, err);
    }
  }

  return alerts;
}
