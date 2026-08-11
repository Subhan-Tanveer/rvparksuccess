/**
 * Campaign Management API
 *
 * Endpoints for:
 * - Creating and managing campaigns
 * - Adding recipients
 * - Executing campaigns
 * - Tracking performance
 * - A/B testing
 */

import { verifySession } from '../_lib/auth.js';
import {
  engineCreateCampaign, engineAddRecipients, engineExecuteCampaign,
  trackCampaignPerformance, calculateCampaignRoi, setupAbTest,
  declareAbTestWinner, getCampaignsWithMetrics, pauseCampaign,
  resumeCampaign, completeCampaign, CAMPAIGN_TYPES,
} from '../_lib/campaign-engine.js';
import {
  getCampaign, getCampaignsByPark, updateCampaign, deleteCampaign,
  getCampaignRecipients, getCampaignPerformance, getCampaignVariants,
} from '../_lib/reservations-store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  try {
    const session = await verifySession(req);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { parkId } = session;
    const { query, body } = req;

    // GET /api/admin/campaigns - List campaigns for park
    if (req.method === 'GET' && !query.campaignId && !query.action) {
      const { status, limit = '50', offset = '0' } = query;
      const campaigns = await getCampaignsByPark(parkId, status || null, parseInt(limit), parseInt(offset));

      // Enrich with performance metrics
      const enriched = await Promise.all(campaigns.map(async (campaign) => {
        const performance = await getCampaignPerformance(campaign.id);
        const recipients = await getCampaignRecipients(campaign.id, 10000, 0);
        return {
          ...campaign,
          recipientCount: recipients.length,
          performance: performance || {
            emailsSent: 0,
            openRatePercent: 0,
            clickRatePercent: 0,
            conversionRatePercent: 0,
            roiPercent: 0,
          },
        };
      }));

      return res.status(200).json(enriched);
    }

    // GET /api/admin/campaigns/:campaignId - Get campaign details
    if (req.method === 'GET' && query.campaignId) {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      const recipients = await getCampaignRecipients(query.campaignId, 10000, 0);
      const performance = await getCampaignPerformance(query.campaignId);
      const variants = await getCampaignVariants(query.campaignId);

      return res.status(200).json({
        ...campaign,
        recipients,
        recipientCount: recipients.length,
        performance,
        variants,
      });
    }

    // GET /api/admin/campaigns/:campaignId/performance - Get detailed performance
    if (req.method === 'GET' && query.action === 'performance') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      const performance = await getCampaignPerformance(query.campaignId);
      const roi = await calculateCampaignRoi(query.campaignId);

      return res.status(200).json({ performance, roi });
    }

    // POST /api/admin/campaigns - Create campaign
    if (req.method === 'POST' && !query.action) {
      const {
        name, type, startDate, endDate, budgetCents, discountAmount,
        discountType = 'percent', promoCode, description,
      } = body;

      if (!name || !type || !startDate || !endDate) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!Object.values(CAMPAIGN_TYPES).includes(type)) {
        return res.status(400).json({ error: `Invalid campaign type: ${type}` });
      }

      try {
        const campaign = await engineCreateCampaign(parkId, {
          name, type, startDate, endDate, budgetCents, discountAmount,
          discountType, promoCode, description,
        });

        return res.status(201).json(campaign);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/recipients - Add recipients
    if (req.method === 'POST' && query.action === 'recipients') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      const { recipients } = body;
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'Recipients must be a non-empty array' });
      }

      try {
        const added = await engineAddRecipients(query.campaignId, recipients);
        return res.status(200).json({ added: added.length, recipients: added });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/execute - Send campaign
    if (req.method === 'POST' && query.action === 'execute') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      if (campaign.status === 'active' || campaign.status === 'completed') {
        return res.status(400).json({ error: 'Campaign already executed' });
      }

      try {
        const summary = await engineExecuteCampaign(query.campaignId, {
          sendEmail: body.sendEmail !== false,
          sendSms: body.sendSms !== false,
        });

        return res.status(200).json(summary);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/performance - Track/recalculate performance
    if (req.method === 'POST' && query.action === 'track-performance') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      try {
        const performance = await trackCampaignPerformance(query.campaignId);
        return res.status(200).json(performance);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/ab-test - Create A/B test
    if (req.method === 'POST' && query.action === 'ab-test') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      const { variantA, variantB } = body;
      if (!variantA || !variantB) {
        return res.status(400).json({ error: 'Both variantA and variantB are required' });
      }

      try {
        const result = await setupAbTest(query.campaignId, variantA, variantB);
        return res.status(200).json(result);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/ab-test/winner - Declare A/B test winner
    if (req.method === 'POST' && query.action === 'ab-test-winner') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      try {
        const winner = await declareAbTestWinner(query.campaignId);
        return res.status(200).json(winner);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/pause - Pause campaign
    if (req.method === 'POST' && query.action === 'pause') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      try {
        const updated = await pauseCampaign(query.campaignId);
        return res.status(200).json(updated);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST /api/admin/campaigns/:campaignId/resume - Resume paused campaign
    if (req.method === 'POST' && query.action === 'resume') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      try {
        const updated = await resumeCampaign(query.campaignId);
        return res.status(200).json(updated);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // PATCH /api/admin/campaigns/:campaignId - Update campaign
    if (req.method === 'PATCH') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      if (campaign.status !== 'draft') {
        return res.status(400).json({ error: 'Can only edit draft campaigns' });
      }

      try {
        const updated = await updateCampaign(query.campaignId, body);
        return res.status(200).json(updated);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // DELETE /api/admin/campaigns/:campaignId - Delete campaign (draft only)
    if (req.method === 'DELETE') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      if (campaign.status !== 'draft') {
        return res.status(400).json({ error: 'Can only delete draft campaigns' });
      }

      try {
        await deleteCampaign(query.campaignId);
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Campaign API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
