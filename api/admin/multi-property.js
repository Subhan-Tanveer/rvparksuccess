// Multi-Property API Routes
// Endpoints for portfolio management, consolidated metrics, bulk operations, and white-label branding

import { requireSession } from '../_lib/auth.js';
import {
  getUserProperties,
  getConsolidatedMetrics,
  getPropertyComparison,
  bulkUpdateRates,
  bulkSendPromotion,
  bulkScheduleMaintenance,
  getPropertyHierarchy,
  getBrandingForProperty,
  applyBranding,
  getConsolidatedAlerts,
} from '../_lib/multi-property-manager.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  // Extract user ID from session (parkId or derive from staff username)
  // For multi-property, we use parkId as userId for now
  const userId = session.parkId;

  const { searchParams } = new URL(req.url || '', `http://${req.headers.host}`);
  const resource = searchParams.get('resource');

  try {
    // GET /api/admin/multi-property/portfolio
    if (req.method === 'GET' && (!resource || resource === 'portfolio')) {
      const properties = await getUserProperties(userId);
      return res.status(200).json({
        properties,
        count: properties.length,
      });
    }

    // GET /api/admin/multi-property/consolidated-metrics?days=30
    if (req.method === 'GET' && resource === 'consolidated-metrics') {
      const days = parseInt(searchParams.get('days') || '30', 10);
      const metrics = await getConsolidatedMetrics(userId, days);
      return res.status(200).json(metrics);
    }

    // GET /api/admin/multi-property/property-comparison?sortBy=revenue
    if (req.method === 'GET' && resource === 'property-comparison') {
      const sortBy = searchParams.get('sortBy') || 'revenue';
      const comparison = await getPropertyComparison(userId, sortBy);
      return res.status(200).json({
        properties: comparison,
      });
    }

    // GET /api/admin/multi-property/alerts
    if (req.method === 'GET' && resource === 'alerts') {
      const alerts = await getConsolidatedAlerts(userId);
      return res.status(200).json({
        alerts,
        count: alerts.length,
      });
    }

    // GET /api/admin/multi-property/hierarchy
    if (req.method === 'GET' && resource === 'hierarchy') {
      const hierarchy = await getPropertyHierarchy(userId);
      return res.status(200).json(hierarchy);
    }

    // GET /api/admin/multi-property/branding/:parkId
    if (req.method === 'GET' && resource === 'branding') {
      const parkId = searchParams.get('parkId');
      if (!parkId) return res.status(400).json({ error: 'parkId required' });

      const branding = await getBrandingForProperty(parkId);
      return res.status(200).json(branding);
    }

    // POST /api/admin/multi-property/bulk-update-rates
    if (req.method === 'POST' && resource === 'bulk-update-rates') {
      const { propertyIds, rateCard } = req.body;
      if (!propertyIds || !Array.isArray(propertyIds) || !rateCard) {
        return res.status(400).json({ error: 'propertyIds array and rateCard required' });
      }

      const result = await bulkUpdateRates(userId, propertyIds, rateCard);
      return res.status(200).json({
        success: true,
        ...result,
      });
    }

    // POST /api/admin/multi-property/bulk-campaign
    if (req.method === 'POST' && resource === 'bulk-campaign') {
      const { propertyIds, campaign } = req.body;
      if (!propertyIds || !Array.isArray(propertyIds) || !campaign) {
        return res.status(400).json({ error: 'propertyIds array and campaign object required' });
      }

      const result = await bulkSendPromotion(userId, propertyIds, campaign);
      return res.status(200).json({
        success: true,
        ...result,
      });
    }

    // POST /api/admin/multi-property/bulk-maintenance
    if (req.method === 'POST' && resource === 'bulk-maintenance') {
      const { propertyIds, siteIds, startDate, endDate, reason } = req.body;
      if (!propertyIds || !startDate || !endDate) {
        return res.status(400).json({ error: 'propertyIds, startDate, and endDate required' });
      }

      const result = await bulkScheduleMaintenance(
        userId,
        propertyIds,
        siteIds || [],
        startDate,
        endDate,
        reason || 'Maintenance'
      );
      return res.status(200).json({
        success: true,
        ...result,
      });
    }

    // POST /api/admin/multi-property/branding
    if (req.method === 'POST' && resource === 'branding') {
      const { parkId, branding } = req.body;
      if (!parkId || !branding) {
        return res.status(400).json({ error: 'parkId and branding required' });
      }

      await applyBranding(parkId, branding);
      return res.status(200).json({
        success: true,
        message: 'Branding updated',
      });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('Multi-property API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
