// Competitive Intelligence API — market analysis and competitor tracking
// GET: fetch market data, comparisons, suggestions, trends
// POST: track new competitor, refresh data
// DELETE: stop tracking competitor

import { requireSession } from '../_lib/auth.js';
import {
  getPark, getCompetitorsForPark, getSitesForPark, getMarketAnalytics,
  getPricingSuggestionsForPark,
} from '../_lib/reservations-store.js';
import {
  getPriceComparison, suggestPriceAdjustment, getMarketTrends,
  identifyPricingOpportunities, addCompetitorForPark, removeCompetitorForPark,
  refreshCompetitorData,
} from '../_lib/competitor-intelligence.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const park = await getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });

  // GET endpoints
  if (req.method === 'GET') {
    const { action } = req.query;

    try {
      // GET /api/admin/competitive-intelligence/competitors
      if (action === 'competitors') {
        const competitors = await getCompetitorsForPark(session.parkId);
        return res.status(200).json({ competitors });
      }

      // GET /api/admin/competitive-intelligence/market-rates
      if (action === 'market-rates') {
        const { siteType } = req.query;
        if (!siteType) {
          return res.status(400).json({ error: 'siteType parameter required (tent|rv|cabin)' });
        }

        const comparison = await getPriceComparison(session.parkId, siteType);
        if (!comparison) {
          return res.status(200).json({
            message: 'No competitor data available yet',
            siteType,
          });
        }

        return res.status(200).json(comparison);
      }

      // GET /api/admin/competitive-intelligence/suggestions
      if (action === 'suggestions') {
        const sites = await getSitesForPark(session.parkId);
        const suggestions = [];

        for (const site of sites) {
          const suggestion = await suggestPriceAdjustment(session.parkId, site.id);
          if (suggestion) {
            suggestions.push({
              ...suggestion,
              site: { id: site.id, name: site.name, type: site.type },
            });
          }
        }

        return res.status(200).json({
          suggestions: suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore),
          generatedAt: new Date().toISOString(),
        });
      }

      // GET /api/admin/competitive-intelligence/trends
      if (action === 'trends') {
        const { days = '90' } = req.query;
        const daysParsed = Math.max(7, Math.min(365, parseInt(days, 10)));

        const trends = await getMarketTrends(session.parkId, daysParsed);
        if (!trends) {
          return res.status(200).json({
            message: 'No trend data available yet',
            requestedDays: daysParsed,
          });
        }

        return res.status(200).json(trends);
      }

      // GET /api/admin/competitive-intelligence/positioning
      if (action === 'positioning') {
        const competitors = await getCompetitorsForPark(session.parkId);
        if (competitors.length === 0) {
          return res.status(200).json({
            message: 'No competitors tracked yet',
            competitorCount: 0,
          });
        }

        const sites = await getSitesForPark(session.parkId);
        const siteTypes = [...new Set(sites.map((s) => s.type))];

        const positioning = {};
        for (const siteType of siteTypes) {
          positioning[siteType] = await getPriceComparison(session.parkId, siteType);
        }

        return res.status(200).json({
          positioning,
          competitorCount: competitors.length,
        });
      }

      // GET /api/admin/competitive-intelligence/opportunities
      if (action === 'opportunities') {
        const opportunities = await identifyPricingOpportunities(session.parkId);
        return res.status(200).json({
          opportunities,
          opportunityCount: opportunities.length,
          generatedAt: new Date().toISOString(),
        });
      }

      // GET /api/admin/competitive-intelligence/dashboard-summary
      if (action === 'dashboard-summary' || !action) {
        const competitors = await getCompetitorsForPark(session.parkId);
        const sites = await getSitesForPark(session.parkId);
        const siteTypes = [...new Set(sites.map((s) => s.type))];

        // Fetch all data in parallel
        const [trends, opportunities] = await Promise.all([
          getMarketTrends(session.parkId, 90),
          identifyPricingOpportunities(session.parkId),
        ]);

        const positioningByType = {};
        for (const siteType of siteTypes) {
          positioningByType[siteType] = await getPriceComparison(session.parkId, siteType);
        }

        return res.status(200).json({
          summary: {
            competitorsTracked: competitors.length,
            sitesManaged: sites.length,
            opportunitiesIdentified: opportunities.length,
            marketTrendDays: 90,
          },
          positioning: positioningByType,
          opportunities: opportunities.slice(0, 5), // Top 5 opportunities
          trends: trends ? trends.trends.slice(-30) : [], // Last 30 days
          lastUpdated: new Date().toISOString(),
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Competitive intelligence GET error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  // POST endpoints
  if (req.method === 'POST') {
    const { action, ...payload } = req.body || {};

    try {
      // POST /api/admin/competitive-intelligence/add-competitor
      if (action === 'add-competitor') {
        const { name, websiteUrl, location } = payload;
        if (!name || !websiteUrl) {
          return res.status(400).json({ error: 'Competitor name and website URL are required' });
        }

        const competitor = await addCompetitorForPark(session.parkId, { name, websiteUrl, location });
        return res.status(201).json({
          competitor,
          message: 'Competitor added successfully',
        });
      }

      // POST /api/admin/competitive-intelligence/refresh
      if (action === 'refresh') {
        const result = await refreshCompetitorData(session.parkId);
        return res.status(200).json({
          message: 'Competitor data refreshed',
          ...result,
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Competitive intelligence POST error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  // DELETE endpoints
  if (req.method === 'DELETE') {
    const { competitorId } = req.body || {};

    try {
      if (!competitorId) {
        return res.status(400).json({ error: 'Competitor ID required' });
      }

      await removeCompetitorForPark(session.parkId, competitorId);
      return res.status(200).json({
        message: 'Competitor removed successfully',
        competitorId,
      });
    } catch (err) {
      console.error('Competitive intelligence DELETE error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
