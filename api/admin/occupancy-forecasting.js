// Occupancy Forecasting API — park staff only. Provides 90-day forecasting,
// seasonal patterns, booking pace analysis, underutilized dates, and staffing
// recommendations. All endpoints are park-scoped via session.parkId.
//
// GET /api/admin/occupancy-forecasting?parkId=X&days=90
// GET /api/admin/occupancy-forecasting?endpoint=seasonal-calendar&parkId=X&year=2026
// GET /api/admin/occupancy-forecasting?endpoint=booking-pace&siteId=Y&date=2026-09-15
// GET /api/admin/occupancy-forecasting?endpoint=trend&parkId=X&days=365
// GET /api/admin/occupancy-forecasting?endpoint=underutilized&parkId=X
// GET /api/admin/occupancy-forecasting?endpoint=confidence&parkId=X&date=2026-09-15
// POST /api/admin/occupancy-forecasting?endpoint=refresh

import { requireSession } from '../_lib/auth.js';
import {
  getPark,
  getSitesForPark,
  getReservationsForParkInRange,
  getOccupancyForecastCache,
  saveOccupancyForecast,
  getSeasonalAnalysis,
  saveSeasonalAnalysis,
} from '../_lib/reservations-store.js';
import {
  forecastOccupancy,
  detectSeason,
  getBookingPaceIndex,
  predictSeasonalPeak,
  analyzeOccupancyTrend,
  getCapacityUtilization,
  identifyUnderutilizedDates,
  getConfidenceForDate,
  detectAnomalies,
} from '../_lib/occupancy-forecaster.js';

const CACHE_HOURS = 24; // Cache forecasts for 24 hours

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { method } = req;
  const { endpoint = 'forecast', parkId = session.parkId, days = '90' } = req.query;

  try {
    // Validate park access
    const park = await getPark(parkId);
    if (!park) return res.status(404).json({ error: 'Park not found' });

    // Verify session has access to this park
    if (session.parkId !== parkId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    switch (method) {
      case 'GET':
        return handleGet(res, endpoint, req.query, park);

      case 'POST':
        if (endpoint === 'refresh') {
          return handleRefresh(res, park);
        }
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });

      default:
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Occupancy forecasting error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGet(res, endpoint, query, park) {
  const { parkId, days = '90', year = '2026', date, siteId } = query;

  switch (endpoint) {
    case 'forecast':
      return getForecast(res, parkId, parseInt(days, 10));

    case 'seasonal-calendar':
      return getSeasonalCalendar(res, parkId, parseInt(year, 10));

    case 'booking-pace':
      return getBookingPace(res, siteId, date);

    case 'trend':
      return getTrend(res, parkId, parseInt(days, 10));

    case 'underutilized':
      return getUnderutilized(res, parkId);

    case 'confidence':
      return getConfidence(res, parkId, date);

    case 'anomalies':
      return getAnomalies(res, parkId);

    case 'peak-prediction':
      return getPeakPrediction(res, parkId);

    case 'capacity-utilization':
      return getCapacityUtil(res, parkId);

    case 'staffing-recommendations':
      return getStaffingRecommendations(res, parkId);

    default:
      return res.status(400).json({ error: 'Unknown endpoint' });
  }
}

async function getForecast(res, parkId, days) {
  try {
    // Get sites to know total count
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({
        forecast: [],
        warning: 'No sites configured for this park',
        cachedAt: null,
      });
    }

    // Check cache first
    const cached = await getOccupancyForecastCache(parkId);
    if (cached && isCacheValid(cached.createdAt, CACHE_HOURS)) {
      return res.json({
        forecast: cached.forecastData || [],
        cachedAt: cached.createdAt,
        cacheValidFor: CACHE_HOURS,
      });
    }

    // Fetch reservations for last 365 days + forecast period
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    // Generate forecast
    const forecast = forecastOccupancy(reservations, totalSites, Math.min(days, 90));

    // Cache result
    await saveOccupancyForecast(parkId, forecast);

    return res.json({
      forecast,
      cachedAt: new Date().toISOString(),
      cacheValidFor: CACHE_HOURS,
    });
  } catch (error) {
    console.error('Forecast error:', error);
    return res.status(500).json({ error: 'Could not generate forecast' });
  }
}

async function getSeasonalCalendar(res, parkId, year) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ calendar: [] });
    }

    // Check cache
    const cached = await getSeasonalAnalysis(parkId);
    if (cached && !hasYearChanged(cached.updatedAt)) {
      return res.json({
        calendar: cached.calendar || [],
        updatedAt: cached.updatedAt,
      });
    }

    // Fetch full year of reservations
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    // Generate 12-month view
    const calendar = [];
    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);

      const monthDays = [];
      for (let day = 1; day <= monthEnd.getDate(); day++) {
        const checkDate = new Date(year, month, day);
        const dateStr = checkDate.toISOString().split('T')[0];

        const bookedSites = new Set();
        for (const res of reservations) {
          const checkIn = new Date(res.checkIn);
          const checkOut = new Date(res.checkOut);
          if (checkIn <= checkDate && checkOut > checkDate && (res.status === 'confirmed' || res.status === 'confirmed-deposit')) {
            bookedSites.add(res.siteId);
          }
        }

        const occupancy = Math.round((bookedSites.size / totalSites) * 100);

        monthDays.push({
          date: dateStr,
          day,
          occupancy,
          season: detectSeason(checkDate),
          isWeekend: checkDate.getDay() === 0 || checkDate.getDay() === 6,
        });
      }

      const monthOccupancy = Math.round(
        monthDays.reduce((sum, d) => sum + d.occupancy, 0) / monthDays.length
      );

      calendar.push({
        month: month + 1,
        monthName: monthStart.toLocaleDateString('en-US', { month: 'long' }),
        year,
        averageOccupancy: monthOccupancy,
        season: detectSeason(monthStart),
        days: monthDays,
      });
    }

    // Cache result
    await saveSeasonalAnalysis(parkId, calendar);

    return res.json({
      calendar,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Seasonal calendar error:', error);
    return res.status(500).json({ error: 'Could not generate seasonal calendar' });
  }
}

async function getBookingPace(res, siteId, targetDate) {
  try {
    if (!siteId || !targetDate) {
      return res.status(400).json({ error: 'Missing siteId or date' });
    }

    // Note: In production, you'd fetch reservations for the specific site
    // For now, we'll use a simplified calculation

    const pace = getBookingPaceIndex([], targetDate);

    return res.json({
      siteId,
      targetDate,
      bookingPaceIndex: pace,
      interpretation:
        pace >= 120 ? 'Faster than normal pace'
          : pace >= 90 ? 'Normal pace'
            : pace >= 70 ? 'Slower than normal pace'
              : 'Much slower than normal',
      expectedDaysBooked: Math.round(40 * (pace / 100)),
    });
  } catch (error) {
    console.error('Booking pace error:', error);
    return res.status(500).json({ error: 'Could not calculate booking pace' });
  }
}

async function getTrend(res, parkId, daysToAnalyze) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ trend: 'insufficient-data' });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToAnalyze);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    const trendAnalysis = analyzeOccupancyTrend(reservations, totalSites, daysToAnalyze);

    return res.json(trendAnalysis);
  } catch (error) {
    console.error('Trend analysis error:', error);
    return res.status(500).json({ error: 'Could not analyze trend' });
  }
}

async function getUnderutilized(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ underutilized: [] });
    }

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    const underutilized = identifyUnderutilizedDates(reservations, totalSites, 90, 40);

    return res.json({
      underutilized,
      count: underutilized.length,
      totalPotentialRevenueLoss: underutilized.reduce((sum, u) => sum + u.potentialRevenueLoss, 0),
    });
  } catch (error) {
    console.error('Underutilized dates error:', error);
    return res.status(500).json({ error: 'Could not identify underutilized dates' });
  }
}

async function getConfidence(res, parkId, date) {
  try {
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }

    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ confidence: 0 });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, 90);
    const confidence = getConfidenceForDate(forecast, date);

    return res.json(confidence);
  } catch (error) {
    console.error('Confidence error:', error);
    return res.status(500).json({ error: 'Could not calculate confidence' });
  }
}

async function getAnomalies(res, parkId) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    const anomalies = detectAnomalies(reservations, 90);

    return res.json({
      anomalies,
      count: anomalies.length,
    });
  } catch (error) {
    console.error('Anomalies error:', error);
    return res.status(500).json({ error: 'Could not detect anomalies' });
  }
}

async function getPeakPrediction(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ peak: null });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const peak = predictSeasonalPeak(reservations, totalSites);

    return res.json({
      peak,
    });
  } catch (error) {
    console.error('Peak prediction error:', error);
    return res.status(500).json({ error: 'Could not predict peak' });
  }
}

async function getCapacityUtil(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ utilization: null });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    const utilization = getCapacityUtilization(reservations, totalSites, 30);

    return res.json(utilization);
  } catch (error) {
    console.error('Capacity utilization error:', error);
    return res.status(500).json({ error: 'Could not calculate capacity utilization' });
  }
}

async function getStaffingRecommendations(res, parkId) {
  try {
    const sites = await getSitesForPark(parkId);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({ recommendations: [] });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      parkId,
      startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, 90);

    const recommendations = [];
    let currentGroup = null;

    for (const day of forecast) {
      if (day.forecastOccupancy >= 80) {
        // High occupancy - need full staff
        if (!currentGroup || currentGroup.level !== 'high') {
          if (currentGroup) {
            recommendations.push(currentGroup);
          }
          currentGroup = {
            level: 'high',
            startDate: day.date,
            endDate: day.date,
            occupancy: day.forecastOccupancy,
            recommendation: 'Full staff - expected high occupancy',
            staffAdjustment: '+2 seasonal staff',
          };
        } else {
          currentGroup.endDate = day.date;
          currentGroup.occupancy = (currentGroup.occupancy + day.forecastOccupancy) / 2;
        }
      } else if (day.forecastOccupancy >= 50) {
        // Medium occupancy
        if (!currentGroup || currentGroup.level !== 'medium') {
          if (currentGroup) {
            recommendations.push(currentGroup);
          }
          currentGroup = {
            level: 'medium',
            startDate: day.date,
            endDate: day.date,
            occupancy: day.forecastOccupancy,
            recommendation: 'Standard staffing level',
            staffAdjustment: 'No change',
          };
        } else {
          currentGroup.endDate = day.date;
          currentGroup.occupancy = (currentGroup.occupancy + day.forecastOccupancy) / 2;
        }
      } else {
        // Low occupancy
        if (!currentGroup || currentGroup.level !== 'low') {
          if (currentGroup) {
            recommendations.push(currentGroup);
          }
          currentGroup = {
            level: 'low',
            startDate: day.date,
            endDate: day.date,
            occupancy: day.forecastOccupancy,
            recommendation: 'Minimal staffing - low occupancy expected',
            staffAdjustment: '-1 to minimal staff',
          };
        } else {
          currentGroup.endDate = day.date;
          currentGroup.occupancy = (currentGroup.occupancy + day.forecastOccupancy) / 2;
        }
      }
    }

    if (currentGroup) {
      recommendations.push(currentGroup);
    }

    return res.json({
      recommendations: recommendations.slice(0, 12), // Next 12 periods
    });
  } catch (error) {
    console.error('Staffing recommendations error:', error);
    return res.status(500).json({ error: 'Could not generate staffing recommendations' });
  }
}

async function handleRefresh(res, park) {
  try {
    const sites = await getSitesForPark(park.id);
    const totalSites = sites.length;

    if (totalSites === 0) {
      return res.json({
        success: false,
        message: 'No sites configured',
      });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const reservations = await getReservationsForParkInRange(
      park.id,
      startDate.toISOString().split('T')[0],
      new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    const forecast = forecastOccupancy(reservations, totalSites, 90);
    await saveOccupancyForecast(park.id, forecast);

    return res.json({
      success: true,
      message: 'Forecast refreshed',
      forecastedDays: forecast.length,
      lastRefreshed: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({
      success: false,
      error: 'Could not refresh forecast',
    });
  }
}

function isCacheValid(createdAt, hoursValid) {
  const created = new Date(createdAt);
  const now = new Date();
  const hoursDiff = (now - created) / (1000 * 60 * 60);
  return hoursDiff < hoursValid;
}

function hasYearChanged(lastUpdate) {
  const last = new Date(lastUpdate);
  const now = new Date();
  return last.getFullYear() !== now.getFullYear();
}
