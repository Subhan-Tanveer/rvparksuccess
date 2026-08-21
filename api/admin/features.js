// Consolidated router for the customer-facing / marketing / analytics admin
// features: analytics, campaigns, social, crm, pricing. Dispatches on the
// `resource` query param so all five live in one Vercel serverless function
// — Vercel's Hobby (free) plan caps a deployment at 12 functions, and each
// file directly under api/ counts as one, so these used to be five separate
// files that blew the budget. The business logic below was lifted from the
// individual api/admin/{analytics,campaigns,social,crm,pricing}.js files
// that used to exist (recoverable at git commit e87d80a) — same behavior,
// just routed through one file. api/_lib/**, which all of this calls into,
// was never deleted and doesn't count toward the function limit.
import { requireSession } from '../_lib/auth.js';
import { getPool } from '../_lib/reservations-store.js';
import {
  getPark,
  getSitesForPark,
  getReservationsForParkInRange,
  getPeakDateRanges,
  updatePricingSettings,
  updateSiteModifier,
  addPeakDateRange,
  removePeakDateRange,
  getPricingLog,
  logPricingChange,
  applyPricingChange,
  applyDynamicPriceOverride,
  getCampaign,
  getCampaignsByPark,
  updateCampaign,
  deleteCampaign,
  getCampaignRecipients,
  getCampaignPerformance,
  getCampaignVariants,
  getGuestsForPark,
  getGuestHistory,
  addGuestNote,
  tagGuest,
  removeTag,
  updateGuestPreferences,
  getGuestSegments,
  identifyAtRiskGuests,
  logCommunication,
} from '../_lib/reservations-store.js';
import {
  calculateRevenueMetrics,
  calculateOccupancyMetrics,
  calculateGuestMetrics,
  calculateTrends,
  calculateDailyRevenue,
  calculatePerSiteMetrics,
  calculateBookingSourceMetrics,
  calculateForecast,
  calculateOccupancyHeatmap,
  calculateTopGuests,
} from '../_lib/analytics-engine.js';
import {
  engineCreateCampaign,
  engineAddRecipients,
  engineExecuteCampaign,
  trackCampaignPerformance,
  calculateCampaignRoi,
  setupAbTest,
  declareAbTestWinner,
  pauseCampaign,
  resumeCampaign,
  CAMPAIGN_TYPES,
} from '../_lib/campaign-engine.js';
import { analyzePricingImpact } from '../_lib/pricing-engine.js';
import { computePriceSuggestionsForPark } from '../_lib/dynamic-pricing.js';
import {
  getSocialAccounts,
  connectSocialAccount,
  disconnectSocialAccount,
  scheduleSocialPost,
  getScheduledPosts,
  publishPost,
  generateCaption,
  autoPostAvailability,
  autoPostPromotion,
  getPostPerformance,
  getSupportedPlatforms,
  getCaptionTemplates,
  deleteSocialPost,
  updateSocialPost,
} from '../_lib/social-media-manager.js';

export default async function handler(req, res) {
  const { resource } = req.query;

  switch (resource) {
    case 'analytics':
      return analyticsHandler(req, res);
    case 'campaigns':
      return campaignsHandler(req, res);
    case 'social':
      return socialHandler(req, res);
    case 'crm':
      return crmHandler(req, res);
    case 'pricing':
      return pricingHandler(req, res);
    default:
      return res.status(400).json({ error: 'Unknown or missing resource parameter' });
  }
}

/* ================================================================== */
/* analytics — lifted from api/admin/analytics.js (unchanged logic)    */
/* ================================================================== */

function parsePeriod(period) {
  const match = period.match(/^(\d+)([d])$/);
  if (!match) return 30;
  return parseInt(match[1], 10);
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

async function analyticsHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { endpoint, period = '30d', days = '30', startDate, endDate, limit = '10' } = req.query;

  try {
    const park = await getPark(session.parkId);
    if (!park) return res.status(404).json({ error: 'Park not found' });

    const sites = await getSitesForPark(session.parkId);

    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    switch (endpoint) {
      case 'overview':
        return analyticsOverview(res, session.parkId, park, sites, period);
      case 'trends':
        return analyticsTrends(res, session.parkId, park, sites, period, req.query.metric || 'revenue');
      case 'sites':
        return analyticsSites(res, session.parkId, park, sites, period);
      case 'forecasting':
        return analyticsForecasting(res, session.parkId, park, sites, period, parseInt(days, 10));
      case 'guests':
        return analyticsGuests(res, session.parkId, park, sites, period);
      case 'sources':
        return analyticsSources(res, session.parkId, park, sites, period);
      case 'heatmap':
        return analyticsHeatmap(res, session.parkId, park, sites, startDate, endDate);
      case 'daily-revenue':
        return analyticsDailyRevenue(res, session.parkId, park, sites, period);
      case 'top-guests':
        return analyticsTopGuests(res, session.parkId, park, sites, period, parseInt(limit, 10));
      default:
        return res.status(400).json({ error: 'Unknown endpoint' });
    }
  } catch (err) {
    console.error('Analytics error:', err.message);
    return res.status(500).json({ error: 'Failed to calculate analytics' });
  }
}

async function analyticsOverview(res, parkId, park, sites, period) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const revenue = calculateRevenueMetrics(reservations, park);
  const occupancy = calculateOccupancyMetrics(reservations, sites.length, start, end);
  const guests = calculateGuestMetrics(reservations);
  return res.status(200).json({
    period,
    dateRange: { start, end },
    revenue: {
      totalRevenueCents: revenue.totalRevenueCents,
      totalRoomRevenueCents: revenue.totalRoomRevenueCents,
      totalTaxCents: revenue.totalTaxCents,
      totalFeeCents: revenue.totalFeeCents,
      totalDiscountCents: revenue.totalDiscountCents,
      adrCents: revenue.adrCents,
      bookingCount: revenue.bookingCount,
    },
    occupancy: {
      occupancyPercent: occupancy.occupancyPercent,
      bookedSiteNights: occupancy.bookedSiteNights,
      totalSiteNights: occupancy.totalSiteNights,
    },
    guests: {
      uniqueGuestCount: guests.uniqueGuestCount,
      repeatGuestPercent: guests.repeatGuestPercent,
      avgStayNights: guests.avgStayNights,
      cancellationPercent: guests.cancellationPercent,
    },
  });
}

async function analyticsTrends(res, parkId, park, sites, currentPeriod, metric) {
  const currentDays = parsePeriod(currentPeriod);
  const { start: currentStart, end: currentEnd } = getDateRange(currentDays);
  const previousEnd = new Date(new Date(currentStart).getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - currentDays * 24 * 60 * 60 * 1000);
  const previousStartStr = previousStart.toISOString().split('T')[0];
  const previousEndStr = previousEnd.toISOString().split('T')[0];

  const [currentRez, previousRez] = await Promise.all([
    getReservationsForParkInRange(parkId, currentStart, currentEnd),
    getReservationsForParkInRange(parkId, previousStartStr, previousEndStr),
  ]);

  const trends = calculateTrends(currentRez, previousRez, sites.length, currentStart, currentEnd, previousStartStr, previousEndStr);

  return res.status(200).json({
    metric,
    period: currentPeriod,
    currentDateRange: { start: currentStart, end: currentEnd },
    previousDateRange: { start: previousStartStr, end: previousEndStr },
    revenueTrendPercent: trends.revenueTrendPercent,
    occupancyTrendPoints: trends.occupancyTrendPoints,
    bookingsTrendPercent: trends.bookingsTrendPercent,
    adrTrendPercent: trends.adrTrendPercent,
    currentMetrics: { revenue: trends.currentRevenue },
    previousMetrics: { revenue: trends.previousRevenue },
  });
}

async function analyticsSites(res, parkId, park, sites, period) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const siteMetrics = calculatePerSiteMetrics(reservations, sites);
  return res.status(200).json({
    period,
    dateRange: { start, end },
    sites: siteMetrics.sort((a, b) => b.totalRevenueCents - a.totalRevenueCents),
  });
}

async function analyticsForecasting(res, parkId, park, sites, period, forecastDays) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const revenue = calculateRevenueMetrics(reservations, park);
  const occupancy = calculateOccupancyMetrics(reservations, sites.length, start, end);
  const forecast = calculateForecast(reservations, revenue.adrCents, forecastDays, 0.85, occupancy.occupancyPercent / 100);
  return res.status(200).json({
    period,
    historicalDateRange: { start, end },
    forecastDays,
    predictedRevenueCents: forecast.predictedRevenueCents,
    lowerBoundCents: forecast.lowerBoundCents,
    upperBoundCents: forecast.upperBoundCents,
    confidencePercent: forecast.confidencePercent,
  });
}

async function analyticsGuests(res, parkId, park, sites, period) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const guests = calculateGuestMetrics(reservations);
  return res.status(200).json({
    period,
    dateRange: { start, end },
    guestMetrics: {
      uniqueGuestCount: guests.uniqueGuestCount,
      repeatGuestCount: guests.repeatGuestCount,
      repeatGuestPercent: guests.repeatGuestPercent,
      avgStayNights: guests.avgStayNights,
      cancellationPercent: guests.cancellationPercent,
      totalBookings: guests.totalBookings,
    },
  });
}

async function analyticsSources(res, parkId, park, sites, period) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const sources = calculateBookingSourceMetrics(reservations);
  return res.status(200).json({
    period,
    dateRange: { start, end },
    sources: sources.sort((a, b) => b.bookingCount - a.bookingCount),
  });
}

async function analyticsHeatmap(res, parkId, park, sites, startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) {
    const { start, end } = getDateRange(30);
    startDateStr = start;
    endDateStr = end;
  }
  const reservations = await getReservationsForParkInRange(parkId, startDateStr, endDateStr);
  const heatmapData = calculateOccupancyHeatmap(reservations, sites, startDateStr, endDateStr);
  return res.status(200).json({ dateRange: { start: startDateStr, end: endDateStr }, heatmap: heatmapData });
}

async function analyticsDailyRevenue(res, parkId, park, sites, period) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const dailyRevenue = calculateDailyRevenue(reservations, start, end);
  return res.status(200).json({ period, dateRange: { start, end }, data: dailyRevenue });
}

async function analyticsTopGuests(res, parkId, park, sites, period, limit) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);
  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const topGuests = calculateTopGuests(reservations, Math.min(limit, 25));
  return res.status(200).json({ period, dateRange: { start, end }, limit, guests: topGuests });
}

/* ================================================================== */
/* campaigns — lifted from api/admin/campaigns.js. Auth was            */
/* `verifySession`, which no longer exists in api/_lib/auth.js; swapped */
/* for the same requireSession() every other admin route uses. The     */
/* frontend used to call path segments like /campaigns/:id/execute —   */
/* Vercel functions here don't support dynamic sub-routes, so those    */
/* are now ?campaignId=&action= query params instead (frontend updated */
/* to match).                                                          */
/* ================================================================== */

async function campaignsHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { parkId } = session;
  const { query, body } = req;

  try {
    // GET — list campaigns for park
    if (req.method === 'GET' && !query.campaignId && !query.action) {
      const { status, limit = '50', offset = '0' } = query;
      const campaigns = await getCampaignsByPark(parkId, status || null, parseInt(limit), parseInt(offset));
      const enriched = await Promise.all(campaigns.map(async (campaign) => {
        const performance = await getCampaignPerformance(campaign.id);
        const recipients = await getCampaignRecipients(campaign.id, 10000, 0);
        return {
          ...campaign,
          recipientCount: recipients.length,
          performance: performance || {
            emailsSent: 0, openRatePercent: 0, clickRatePercent: 0, conversionRatePercent: 0, roiPercent: 0,
          },
        };
      }));
      return res.status(200).json(enriched);
    }

    // GET — single campaign details
    if (req.method === 'GET' && query.campaignId && !query.action) {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });

      const recipients = await getCampaignRecipients(query.campaignId, 10000, 0);
      const performance = await getCampaignPerformance(query.campaignId);
      const variants = await getCampaignVariants(query.campaignId);

      return res.status(200).json({ ...campaign, recipients, recipientCount: recipients.length, performance, variants });
    }

    // GET — detailed performance/ROI
    if (req.method === 'GET' && query.action === 'performance') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      const performance = await getCampaignPerformance(query.campaignId);
      const roi = await calculateCampaignRoi(query.campaignId);
      return res.status(200).json({ performance, roi });
    }

    // POST — create campaign
    if (req.method === 'POST' && !query.action) {
      const { name, type, startDate, endDate, budgetCents, discountAmount, discountType = 'percent', promoCode, description } = body;
      if (!name || !type || !startDate || !endDate) return res.status(400).json({ error: 'Missing required fields' });
      if (!Object.values(CAMPAIGN_TYPES).includes(type)) return res.status(400).json({ error: `Invalid campaign type: ${type}` });

      try {
        const campaign = await engineCreateCampaign(parkId, { name, type, startDate, endDate, budgetCents, discountAmount, discountType, promoCode, description });
        return res.status(201).json(campaign);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST — add recipients
    if (req.method === 'POST' && query.action === 'recipients') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      const { recipients } = body;
      if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: 'Recipients must be a non-empty array' });
      try {
        const added = await engineAddRecipients(query.campaignId, recipients);
        return res.status(200).json({ added: added.length, recipients: added });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST — execute (send) campaign
    if (req.method === 'POST' && query.action === 'execute') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      if (campaign.status === 'active' || campaign.status === 'completed') return res.status(400).json({ error: 'Campaign already executed' });
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

    // POST — recalculate performance
    if (req.method === 'POST' && query.action === 'track-performance') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      try {
        const performance = await trackCampaignPerformance(query.campaignId);
        return res.status(200).json(performance);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST — set up A/B test
    if (req.method === 'POST' && query.action === 'ab-test') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      const { variantA, variantB } = body;
      if (!variantA || !variantB) return res.status(400).json({ error: 'Both variantA and variantB are required' });
      try {
        const result = await setupAbTest(query.campaignId, variantA, variantB);
        return res.status(200).json(result);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST — declare A/B test winner
    if (req.method === 'POST' && query.action === 'ab-test-winner') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      try {
        const winner = await declareAbTestWinner(query.campaignId);
        return res.status(200).json(winner);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST — pause campaign
    if (req.method === 'POST' && query.action === 'pause') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      try {
        const updated = await pauseCampaign(query.campaignId);
        return res.status(200).json(updated);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // POST — resume campaign
    if (req.method === 'POST' && query.action === 'resume') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      try {
        const updated = await resumeCampaign(query.campaignId);
        return res.status(200).json(updated);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // PATCH — update draft campaign
    if (req.method === 'PATCH') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      if (campaign.status !== 'draft') return res.status(400).json({ error: 'Can only edit draft campaigns' });
      try {
        const updated = await updateCampaign(query.campaignId, body);
        return res.status(200).json(updated);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // DELETE — delete draft campaign
    if (req.method === 'DELETE') {
      const campaign = await getCampaign(query.campaignId);
      if (!campaign || campaign.parkId !== parkId) return res.status(404).json({ error: 'Campaign not found' });
      if (campaign.status !== 'draft') return res.status(400).json({ error: 'Can only delete draft campaigns' });
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

/* ================================================================== */
/* social — lifted from api/admin/social.js. Its original auth          */
/* (`X-Park-Id` / `Authorization: Bearer <localStorage token>` headers) */
/* never matched how the rest of the app authenticates (signed session  */
/* cookie via requireSession) and the frontend didn't reliably send a   */
/* real token — swapped for requireSession like every other resource   */
/* here. Path segments (/social/accounts, /social/post/delete, ...)    */
/* became ?action= query values (frontend updated to match). Reuses    */
/* the shared connection pool from reservations-store.js instead of    */
/* opening a second one.                                               */
/* ================================================================== */

async function socialHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const pool = getPool();
  const parkId = session.parkId;
  const { action } = req.query;

  try {
    if (req.method === 'GET' && (action === 'accounts' || !action)) {
      const accounts = await getSocialAccounts(pool, parkId);
      const safe = accounts.map((acc) => ({
        id: acc.id,
        platform: acc.platform,
        username: acc.username,
        status: acc.status,
        lastPosted: acc.last_posted,
        createdAt: acc.created_at,
        platformConfig: {
          name: acc.platform === 'facebook' ? 'Facebook' : acc.platform === 'instagram' ? 'Instagram' : acc.platform === 'tiktok' ? 'TikTok' : 'Twitter/X',
          color: acc.platform === 'facebook' ? '#1877F2' : acc.platform === 'instagram' ? '#E1306C' : acc.platform === 'tiktok' ? '#000000' : '#1DA1F2',
        },
      }));
      return res.status(200).json({ accounts: safe });
    }

    if (req.method === 'GET' && action === 'platforms') {
      return res.status(200).json({ platforms: getSupportedPlatforms() });
    }

    if (req.method === 'POST' && action === 'connect') {
      const { platform, accessToken, refreshToken, username } = req.body;
      if (!platform || !accessToken) return res.status(400).json({ error: 'Platform and accessToken required' });
      const account = await connectSocialAccount(pool, parkId, platform, accessToken, refreshToken, username);
      return res.status(200).json({ success: true, account });
    }

    if (req.method === 'POST' && action === 'disconnect') {
      const { platform } = req.body;
      if (!platform) return res.status(400).json({ error: 'Platform required' });
      await disconnectSocialAccount(pool, parkId, platform);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET' && action === 'scheduled') {
      const { platform } = req.query;
      const posts = await getScheduledPosts(pool, parkId, platform);
      return res.status(200).json({ posts });
    }

    if (req.method === 'POST' && action === 'post') {
      const { platform, content, imageUrl, scheduleTime, publish } = req.body;
      if (!platform || !content) return res.status(400).json({ error: 'Platform and content required' });

      let post = await scheduleSocialPost(pool, parkId, platform, content, imageUrl, scheduleTime);

      if (publish) {
        const accounts = await getSocialAccounts(pool, parkId);
        const account = accounts.find((a) => a.platform === platform);
        if (!account) return res.status(400).json({ error: 'No account connected for this platform' });
        post = await publishPost(pool, parkId, post.id, account.accessToken, platform);
      }

      return res.status(200).json({ success: true, post });
    }

    if (req.method === 'POST' && action === 'schedule') {
      const { platform, content, imageUrl, scheduledTime } = req.body;
      if (!platform || !content || !scheduledTime) return res.status(400).json({ error: 'Platform, content, and scheduledTime required' });
      const post = await scheduleSocialPost(pool, parkId, platform, content, imageUrl, new Date(scheduledTime));
      return res.status(200).json({ success: true, post });
    }

    if (req.method === 'POST' && action === 'auto-post') {
      const { type, parkName, availableDates, campaignName, discount, endDate, siteType } = req.body;
      if (!type || !parkName) return res.status(400).json({ error: 'Type and parkName required' });

      let posts = [];
      if (type === 'availability') {
        posts = await autoPostAvailability(pool, parkId, availableDates, parkName, siteType);
      } else if (type === 'promotion') {
        posts = await autoPostPromotion(pool, parkId, campaignName, discount, endDate, parkName);
      } else {
        return res.status(400).json({ error: 'Invalid type (availability or promotion)' });
      }

      return res.status(200).json({ success: true, posts });
    }

    if (req.method === 'GET' && action === 'performance') {
      const { platform, days } = req.query;
      if (!platform) return res.status(400).json({ error: 'Platform required' });
      const posts = await getPostPerformance(pool, parkId, platform, days ? Number(days) : 30);
      return res.status(200).json({ posts });
    }

    if (req.method === 'GET' && action === 'captions') {
      return res.status(200).json({ templates: getCaptionTemplates() });
    }

    if (req.method === 'POST' && action === 'generate-caption') {
      const { offerType, parkName, details } = req.body;
      if (!offerType || !parkName) return res.status(400).json({ error: 'OfferType and parkName required' });
      const caption = generateCaption(offerType, parkName, details || {});
      return res.status(200).json({ caption });
    }

    if (req.method === 'POST' && action === 'delete-post') {
      const { postId } = req.body;
      if (!postId) return res.status(400).json({ error: 'PostId required' });
      await deleteSocialPost(pool, parkId, postId);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'update-post') {
      const { postId, content, imageUrl, scheduledTime } = req.body;
      if (!postId) return res.status(400).json({ error: 'PostId required' });
      const updates = {};
      if (content !== undefined) updates.content = content;
      if (imageUrl !== undefined) updates.image_url = imageUrl;
      if (scheduledTime !== undefined) updates.scheduled_time = new Date(scheduledTime);
      const post = await updateSocialPost(pool, parkId, postId, updates);
      return res.status(200).json({ success: true, post });
    }

    return res.status(404).json({ error: 'Unknown social action' });
  } catch (err) {
    console.error('Social media API error:', err);
    return res.status(err.status || 400).json({ error: err.message || 'Internal server error' });
  }
}

/* ================================================================== */
/* crm — lifted from api/admin/crm.js (unchanged logic)                */
/* ================================================================== */

async function crmHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const parkId = session.parkId;
  const { action, guestEmail, tagId } = req.query;

  if (req.method === 'GET' && action === 'guests') {
    try {
      const page = parseInt(req.query.page || '0', 10);
      const limit = 50;
      const offset = page * limit;
      const { guests, total } = await getGuestsForPark(parkId, limit, offset);
      return res.status(200).json({ guests, total, page, limit, hasMore: offset + limit < total });
    } catch (err) {
      console.error('Error listing guests:', err.message);
      return res.status(500).json({ error: 'Failed to load guests' });
    }
  }

  if (req.method === 'GET' && action === 'guest' && guestEmail) {
    try {
      const history = await getGuestHistory(parkId, guestEmail);
      return res.status(200).json({ history });
    } catch (err) {
      console.error('Error loading guest history:', err.message);
      return res.status(500).json({ error: 'Failed to load guest profile' });
    }
  }

  if (req.method === 'GET' && action === 'segments') {
    try {
      const segments = await getGuestSegments(parkId);
      return res.status(200).json({ segments });
    } catch (err) {
      console.error('Error loading segments:', err.message);
      return res.status(500).json({ error: 'Failed to load segments' });
    }
  }

  if (req.method === 'GET' && action === 'at-risk') {
    try {
      const limit = parseInt(req.query.limit || '10', 10);
      const guests = await identifyAtRiskGuests(parkId, limit);
      return res.status(200).json({ guests });
    } catch (err) {
      console.error('Error loading at-risk guests:', err.message);
      return res.status(500).json({ error: 'Failed to load at-risk guests' });
    }
  }

  if (req.method === 'POST' && action === 'note') {
    const { guestEmail: email, noteText, staffId } = req.body;
    if (!email || !noteText) return res.status(400).json({ error: 'Guest email and note text are required' });
    try {
      const note = await addGuestNote(parkId, email, noteText, staffId);
      return res.status(201).json({ note });
    } catch (err) {
      console.error('Error adding note:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'tag') {
    const { guestEmail: email, tagName } = req.body;
    if (!email || !tagName) return res.status(400).json({ error: 'Guest email and tag name are required' });
    try {
      const tag = await tagGuest(parkId, email, tagName);
      if (!tag) return res.status(400).json({ error: 'Tag already exists on this guest' });
      return res.status(201).json({ tag });
    } catch (err) {
      console.error('Error adding tag:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE' && action === 'tag' && tagId) {
    try {
      const success = await removeTag(parkId, tagId);
      if (!success) return res.status(404).json({ error: 'Tag not found' });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Error removing tag:', err.message);
      return res.status(500).json({ error: 'Failed to remove tag' });
    }
  }

  if (req.method === 'POST' && action === 'preferences') {
    const { guestEmail: email, preferences } = req.body;
    if (!email || !preferences) return res.status(400).json({ error: 'Guest email and preferences are required' });
    try {
      const updated = await updateGuestPreferences(parkId, email, preferences);
      return res.status(200).json({ profile: updated });
    } catch (err) {
      console.error('Error updating preferences:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'communication') {
    const { guestEmail: email, type, subject, messagePreview, status } = req.body;
    if (!email || !type) return res.status(400).json({ error: 'Guest email and communication type are required' });
    try {
      const comm = await logCommunication(parkId, email, { type, subject, messagePreview, status });
      return res.status(201).json({ communication: comm });
    } catch (err) {
      console.error('Error logging communication:', err.message);
      return res.status(500).json({ error: 'Failed to log communication' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/* ================================================================== */
/* pricing — lifted from api/admin/pricing.js (unchanged logic)        */
/* ================================================================== */

async function pricingHandler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const park = await getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });

  if (req.method === 'GET') {
    try {
      const sites = await getSitesForPark(session.parkId);
      const peakRanges = await getPeakDateRanges(session.parkId);
      const pricingLog = await getPricingLog(session.parkId);

      const settings = {
        dynamicPricingEnabled: park.dynamicPricingEnabled,
        minPriceCents: park.minPriceCents,
        maxPriceCents: park.maxPriceCents,
        occupancyTargetPercent: park.occupancyTargetPercent,
      };

      return res.status(200).json({
        settings,
        sites: sites.map((s) => ({ id: s.id, name: s.name, baseRate: s.nightlyRateCents, priceModifier: s.priceModifier })),
        peakRanges,
        pricingLog,
      });
    } catch (err) {
      console.error('Pricing GET error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { action, ...payload } = req.body || {};

    try {
      if (action === 'updateSettings') {
        const updated = await updatePricingSettings(session.parkId, payload);
        return res.status(200).json({ park: updated });
      }

      if (action === 'calculate') {
        const { dateRange, includeRecommendations = true } = payload;
        if (!dateRange || !dateRange.start || !dateRange.end) return res.status(400).json({ error: 'Date range required: { start, end }' });

        // Shared with the nightly auto-apply cron (api/_lib/dynamic-pricing.js)
        // so the two paths always compute the same numbers for the same inputs.
        const { suggestions } = await computePriceSuggestionsForPark(session.parkId, dateRange.start, dateRange.end);

        const occupancyByDate = {};
        for (const s of suggestions) occupancyByDate[s.date] = s.occupancyPercent;

        let potentialImpact = null;
        if (includeRecommendations) {
          potentialImpact = analyzePricingImpact(suggestions);
        }

        return res.status(200).json({ suggestions, potentialImpact, occupancyByDate });
      }

      if (action === 'applyPrice') {
        const { siteId, dateOfStay, appliedRateCents } = payload;
        if (!siteId || !dateOfStay || !appliedRateCents) return res.status(400).json({ error: 'siteId, dateOfStay, and appliedRateCents required' });

        // Actually change what a guest pays for this date — logging alone
        // (below) is just an audit trail and was previously mistaken for
        // being the real price change.
        await applyDynamicPriceOverride(siteId, session.parkId, dateOfStay, appliedRateCents);

        const existingLogs = await getPricingLog(session.parkId, dateOfStay, dateOfStay);
        const existingLog = existingLogs.find((l) => l.siteId === siteId && l.dateOfStay === dateOfStay && l.status !== 'applied');

        if (existingLog) {
          const updated = await applyPricingChange(existingLog.id, appliedRateCents, session.username);
          return res.status(200).json({ pricingLog: updated });
        }

        const { previousRate } = payload;
        if (!previousRate) return res.status(400).json({ error: 'previousRate required for new price log' });

        const logged = await logPricingChange(session.parkId, siteId, dateOfStay, previousRate, appliedRateCents);
        const updated = await applyPricingChange(logged.id, appliedRateCents, session.username);
        return res.status(201).json({ pricingLog: updated });
      }

      if (action === 'toggleDynamicPricing') {
        const updated = await updatePricingSettings(session.parkId, { dynamicPricingEnabled: !park.dynamicPricingEnabled });
        return res.status(200).json({ park: updated });
      }

      if (action === 'updateSiteModifier') {
        const { siteId, priceModifier } = payload;
        if (!siteId || priceModifier === undefined) return res.status(400).json({ error: 'siteId and priceModifier required' });
        const updated = await updateSiteModifier(siteId, session.parkId, priceModifier);
        return res.status(200).json({ site: updated });
      }

      if (action === 'addPeakRange') {
        const { label, startDate, endDate } = payload;
        const updated = await addPeakDateRange(session.parkId, { label, startDate, endDate });
        return res.status(201).json({ peakRanges: updated });
      }

      if (action === 'removePeakRange') {
        const { rangeId } = payload;
        if (!rangeId) return res.status(400).json({ error: 'rangeId required' });
        const updated = await removePeakDateRange(session.parkId, rangeId);
        return res.status(200).json({ peakRanges: updated });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Pricing POST error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
