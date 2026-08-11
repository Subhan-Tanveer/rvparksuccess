// Advanced Analytics API endpoints — park staff only. Provides comprehensive
// analytics, trends, forecasting, and segmentation data for the analytics
// dashboard. All endpoints return park-scoped data (via session.parkId),
// so staff can only see their own park's analytics.
//
// GET /api/admin/analytics/overview?parkId=X&period=7d|30d|90d
// GET /api/admin/analytics/trends?parkId=X&metric=revenue|occupancy|bookings&period=7d|30d|90d
// GET /api/admin/analytics/sites?parkId=X&period=7d|30d|90d
// GET /api/admin/analytics/forecasting?parkId=X&days=30|60|90
// GET /api/admin/analytics/guests?parkId=X&period=7d|30d|90d|365d
// GET /api/admin/analytics/sources?parkId=X&period=7d|30d|90d
// GET /api/admin/analytics/heatmap?parkId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

import { requireSession } from '../_lib/auth.js';
import {
  getPark,
  getSitesForPark,
  getReservationsForParkInRange,
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

// Parse period strings like "7d", "30d", "90d" into days
function parsePeriod(period) {
  const match = period.match(/^(\d+)([d])$/);
  if (!match) return 30; // Default to 30 days
  return parseInt(match[1], 10);
}

// Calculate date range from period string
function getDateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

export default async function handler(req, res) {
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

    // Route to specific analytics endpoint
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    switch (endpoint) {
      case 'overview':
        return handleOverview(res, session.parkId, park, sites, period);

      case 'trends':
        return handleTrends(res, session.parkId, park, sites, period, req.query.metric || 'revenue');

      case 'sites':
        return handleSites(res, session.parkId, park, sites, period);

      case 'forecasting':
        return handleForecasting(res, session.parkId, park, sites, period, parseInt(days, 10));

      case 'guests':
        return handleGuests(res, session.parkId, park, sites, period);

      case 'sources':
        return handleSources(res, session.parkId, park, sites, period);

      case 'heatmap':
        return handleHeatmap(res, session.parkId, park, sites, startDate, endDate);

      case 'daily-revenue':
        return handleDailyRevenue(res, session.parkId, park, sites, period);

      case 'top-guests':
        return handleTopGuests(res, session.parkId, park, sites, period, parseInt(limit, 10));

      default:
        return res.status(400).json({ error: 'Unknown endpoint' });
    }
  } catch (err) {
    console.error('Analytics error:', err.message);
    return res.status(500).json({ error: 'Failed to calculate analytics' });
  }
}

async function handleOverview(res, parkId, park, sites, period) {
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

async function handleTrends(res, parkId, park, sites, currentPeriod, metric) {
  const currentDays = parsePeriod(currentPeriod);
  const { start: currentStart, end: currentEnd } = getDateRange(currentDays);

  // Get previous period of same length
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
    occupancyTrendPercent: trends.occupancyTrendPercent,
    bookingsTrendPercent: trends.bookingsTrendPercent,
    adrTrendPercent: trends.adrTrendPercent,
    currentMetrics: {
      revenue: trends.currentRevenue,
    },
    previousMetrics: {
      revenue: trends.previousRevenue,
    },
  });
}

async function handleSites(res, parkId, park, sites, period) {
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

async function handleForecasting(res, parkId, park, sites, period, forecastDays) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);

  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const revenue = calculateRevenueMetrics(reservations, park);

  const forecast = calculateForecast(reservations, revenue.adrCents, forecastDays, 0.85);

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

async function handleGuests(res, parkId, park, sites, period) {
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

async function handleSources(res, parkId, park, sites, period) {
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

async function handleHeatmap(res, parkId, park, sites, startDateStr, endDateStr) {
  // Validate dates
  if (!startDateStr || !endDateStr) {
    const { start, end } = getDateRange(30);
    startDateStr = start;
    endDateStr = end;
  }

  const reservations = await getReservationsForParkInRange(parkId, startDateStr, endDateStr);
  const heatmapData = calculateOccupancyHeatmap(reservations, sites, startDateStr, endDateStr);

  return res.status(200).json({
    dateRange: { start: startDateStr, end: endDateStr },
    heatmap: heatmapData,
  });
}

async function handleDailyRevenue(res, parkId, park, sites, period) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);

  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const dailyRevenue = calculateDailyRevenue(reservations, start, end);

  return res.status(200).json({
    period,
    dateRange: { start, end },
    data: dailyRevenue,
  });
}

async function handleTopGuests(res, parkId, park, sites, period, limit) {
  const days = parsePeriod(period);
  const { start, end } = getDateRange(days);

  const reservations = await getReservationsForParkInRange(parkId, start, end);
  const topGuests = calculateTopGuests(reservations, Math.min(limit, 25));

  return res.status(200).json({
    period,
    dateRange: { start, end },
    limit,
    guests: topGuests,
  });
}
