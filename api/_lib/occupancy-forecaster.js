// Occupancy Forecasting Engine — predict future occupancy based on historical
// patterns, seasonal trends, booking pace, and market signals. All functions
// operate on already-fetched data (reservations, seasonal rates, blocked dates).
//
// Core forecasting models:
// - Seasonal decomposition: identify and project annual/quarterly patterns
// - Trend analysis: is occupancy improving or declining?
// - Booking pace: compare current pace to historical average
// - Anomaly detection: flag unusual booking patterns
// - Confidence intervals: quantify forecast uncertainty

/**
 * Forecast daily occupancy for next N days
 * @param {Array} reservations - Historical and upcoming reservations
 * @param {number} totalSites - Number of sites in park
 * @param {number} days - Number of days to forecast (default 90)
 * @param {Object} options - { seasonalWeighting: 0.5, trendWeighting: 0.3, paceWeighting: 0.2 }
 * @returns {Array} Daily forecast objects with occupancy%, confidence interval
 */
export function forecastOccupancy(reservations, totalSites, days = 90, options = {}) {
  const {
    seasonalWeighting = 0.5,
    trendWeighting = 0.3,
    paceWeighting = 0.2,
  } = options;

  if (!reservations || !Array.isArray(reservations) || totalSites <= 0) {
    return generateDefaultForecast(days);
  }

  const today = new Date();
  const forecast = [];

  // Build historical occupancy data (last 365 days)
  const historicalDays = getHistoricalOccupancy(reservations, totalSites, 365);

  // Calculate components
  const seasonalPattern = extractSeasonalPattern(historicalDays);
  const trendComponent = calculateTrend(historicalDays);
  const paceComponent = calculateBookingPace(reservations, totalSites);

  // Forecast each day
  for (let i = 0; i < days; i++) {
    const forecastDate = new Date(today);
    forecastDate.setDate(forecastDate.getDate() + i + 1);
    const dateStr = forecastDate.toISOString().split('T')[0];

    // Get booked sites for this date
    const bookedSites = countBookedSites(reservations, dateStr);
    const baseOccupancy = (bookedSites / totalSites) * 100;

    // Seasonal component (0-100)
    const dayOfYear = getDayOfYear(forecastDate);
    const seasonalFactor = seasonalPattern[dayOfYear] || 50;

    // Trend component (adjust based on recent direction)
    const trendAdjustment = trendComponent.slope * (i / 30); // Gradual trend

    // Booking pace component
    const paceAdjustment = (paceComponent.currentPace - 100) / 2; // Scale down

    // Weighted forecast
    const forecastOccupancy = Math.max(0, Math.min(100,
      (baseOccupancy * 0.2) +
      (seasonalFactor * seasonalWeighting) +
      (50 + trendAdjustment * trendWeighting) +
      (50 + paceAdjustment * paceWeighting)
    ));

    // Confidence interval (widens with distance into future)
    const confidenceMargin = 5 + (i * 0.3); // 5% to ~35% over 90 days
    const trend = trendComponent.slope > 0.5 ? 'improving' : trendComponent.slope < -0.5 ? 'declining' : 'stable';

    forecast.push({
      date: dateStr,
      dayNumber: i + 1,
      forecastOccupancy: Math.round(forecastOccupancy * 10) / 10,
      confidenceLower: Math.max(0, Math.round((forecastOccupancy - confidenceMargin) * 10) / 10),
      confidenceUpper: Math.min(100, Math.round((forecastOccupancy + confidenceMargin) * 10) / 10),
      confidenceMargin: Math.round(confidenceMargin * 10) / 10,
      season: detectSeason(forecastDate),
      trend,
      components: {
        baseOccupancy: Math.round(baseOccupancy * 10) / 10,
        seasonalInfluence: Math.round(seasonalFactor * 10) / 10,
        trendInfluence: Math.round((50 + trendAdjustment * trendWeighting) * 10) / 10,
        paceInfluence: Math.round((50 + paceAdjustment * paceWeighting) * 10) / 10,
      },
    });
  }

  return forecast;
}

/**
 * Detect the season for a given date
 * @param {Date|string} date - Date to classify
 * @returns {string} Season name: 'peak', 'shoulder', 'low'
 */
export function detectSeason(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth(); // 0-11
  const dayOfYear = getDayOfYear(d);

  // Typical RV park seasonality in North America
  // Peak: May-September (summer)
  // Shoulder: April, October (spring/fall)
  // Low: November-March (winter)

  if (month >= 4 && month <= 8) { // May-Sept
    return 'peak';
  } else if ((month === 3) || (month === 9)) { // April, Oct
    return 'shoulder';
  } else {
    return 'low';
  }
}

/**
 * Get booking pace index (how booked are we relative to history?)
 * @param {Array} reservations - All reservations
 * @param {string} targetDate - Date to check booking for
 * @param {number} lookbackDays - Historical window to compare against (default 365)
 * @returns {number} Index where 100 = normal pace, 80 = slower, 120 = faster
 */
export function getBookingPaceIndex(reservations, targetDate, lookbackDays = 365) {
  if (!reservations || !Array.isArray(reservations)) return 100;

  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const daysUntilTarget = Math.ceil((target - new Date()) / (1000 * 60 * 60 * 24));

  if (daysUntilTarget < 1) return 100; // Past date

  // Count bookings for target date made within daysUntilTarget days in the past
  const historicalWindow = new Date();
  historicalWindow.setDate(historicalWindow.getDate() - lookbackDays);

  // Count confirmed bookings created within the historical window
  const recentBookings = reservations.filter((r) => {
    const createdAt = new Date(r.createdAt);
    const daysTillCheckIn = Math.ceil((new Date(r.checkIn) - createdAt) / (1000 * 60 * 60 * 24));

    // This booking was made when target date was ~daysUntilTarget days out
    return (
      createdAt >= historicalWindow &&
      (r.status === 'confirmed' || r.status === 'confirmed-deposit') &&
      Math.abs(daysTillCheckIn - daysUntilTarget) < 3 // Within 3 days of same advance window
    );
  });

  const historicalCount = recentBookings.length;

  // Count current bookings for target date
  const currentBookings = reservations.filter((r) => {
    const checkIn = new Date(r.checkIn);
    const checkOut = new Date(r.checkOut);
    return (
      checkIn <= target &&
      checkOut > target &&
      (r.status === 'confirmed' || r.status === 'confirmed-deposit')
    );
  });

  const currentCount = currentBookings.length;

  if (historicalCount === 0) return 100;

  return Math.round((currentCount / historicalCount) * 100);
}

/**
 * Predict when the next seasonal peak will occur
 * @param {Array} reservations - Reservation history
 * @param {number} totalSites - Number of sites
 * @param {number} peakThreshold - Occupancy % threshold for peak (default 75%)
 * @returns {Object} { startDate, endDate, expectedOccupancy, daysUntilPeak }
 */
export function predictSeasonalPeak(reservations, totalSites, peakThreshold = 75) {
  if (!reservations || totalSites <= 0) return null;

  const today = new Date();
  const forecast = forecastOccupancy(reservations, totalSites, 365);

  // Find first sustained period above threshold
  let peakStart = null;
  let consecutiveDays = 0;

  for (const day of forecast) {
    if (day.forecastOccupancy >= peakThreshold) {
      if (!peakStart) {
        peakStart = new Date(day.date);
      }
      consecutiveDays++;

      if (consecutiveDays >= 7) {
        // Found a 7-day peak
        const peakEnd = new Date(day.date);
        peakEnd.setDate(peakEnd.getDate() + 7);

        return {
          startDate: peakStart.toISOString().split('T')[0],
          endDate: peakEnd.toISOString().split('T')[0],
          expectedOccupancy: Math.round(
            forecast
              .filter((d) => new Date(d.date) >= peakStart && new Date(d.date) <= peakEnd)
              .reduce((sum, d) => sum + d.forecastOccupancy, 0) / 7
          ),
          daysUntilPeak: Math.ceil((peakStart - today) / (1000 * 60 * 60 * 24)),
        };
      }
    } else {
      consecutiveDays = 0;
      peakStart = null;
    }
  }

  return null;
}

/**
 * Analyze long-term occupancy trend
 * @param {Array} reservations - Reservation history
 * @param {number} totalSites - Number of sites
 * @param {number} days - Days to analyze (default 365)
 * @returns {Object} { trend: 'up'|'down'|'stable', slope, r2, direction }
 */
export function analyzeOccupancyTrend(reservations, totalSites, days = 365) {
  const historicalOccupancy = getHistoricalOccupancy(reservations, totalSites, days);

  if (historicalOccupancy.length < 7) {
    return { trend: 'insufficient-data', slope: 0, r2: 0, direction: '→' };
  }

  // Linear regression
  const regression = linearRegression(
    historicalOccupancy.map((d, i) => ({ x: i, y: d.occupancy }))
  );

  let trend = 'stable';
  let direction = '→';

  if (regression.slope > 0.5) {
    trend = 'improving';
    direction = '↑';
  } else if (regression.slope < -0.5) {
    trend = 'declining';
    direction = '↓';
  }

  return {
    trend,
    slope: Math.round(regression.slope * 1000) / 1000,
    r2: Math.round(regression.r2 * 1000) / 1000,
    direction,
    changePercent: Math.round(regression.slope * days * 10) / 10,
  };
}

/**
 * Calculate park-wide capacity utilization
 * @param {Array} reservations - All reservations
 * @param {number} totalSites - Number of sites
 * @param {number} daysToAnalyze - Future days to check (default 30)
 * @returns {Object} { utilizationPercent, potentialRevenueCents, capturedRevenueCents, gaps }
 */
export function getCapacityUtilization(reservations, totalSites, daysToAnalyze = 30) {
  if (!reservations || totalSites <= 0) {
    return {
      utilizationPercent: 0,
      potentialRevenueCents: 0,
      capturedRevenueCents: 0,
      gaps: [],
    };
  }

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + daysToAnalyze);

  // Calculate total possible site-nights
  const totalPossibleSiteNights = totalSites * daysToAnalyze;

  // Count booked site-nights
  let bookedSiteNights = 0;
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  for (const res of confirmed) {
    const checkIn = new Date(res.checkIn);
    const checkOut = new Date(res.checkOut);

    const overlapStart = new Date(Math.max(today.getTime(), checkIn.getTime()));
    const overlapEnd = new Date(Math.min(endDate.getTime(), checkOut.getTime()));

    if (overlapEnd > overlapStart) {
      const nights = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
      bookedSiteNights += nights;
    }
  }

  const utilizationPercent = Math.round((bookedSiteNights / totalPossibleSiteNights) * 1000) / 10;
  const capturedRevenueCents = confirmed.reduce((sum, r) => sum + r.totalCents, 0);

  return {
    utilizationPercent,
    potentialSiteNights: totalPossibleSiteNights,
    bookedSiteNights,
    capturedRevenueCents,
    gaps: identifyUnderutilizedDateRanges(reservations, totalSites, daysToAnalyze),
  };
}

/**
 * Identify dates with low occupancy and opportunity
 * @param {Array} reservations - All reservations
 * @param {number} totalSites - Number of sites
 * @param {number} daysToAnalyze - Future days to check (default 90)
 * @param {number} lowThreshold - Occupancy % below which to flag (default 40%)
 * @returns {Array} Low-occupancy date ranges with recommendations
 */
export function identifyUnderutilizedDates(reservations, totalSites, daysToAnalyze = 90, lowThreshold = 40) {
  const ranges = identifyUnderutilizedDateRanges(reservations, totalSites, daysToAnalyze, lowThreshold);
  return ranges.map((range) => ({
    startDate: range.startDate,
    endDate: range.endDate,
    nights: range.nights,
    averageOccupancy: range.averageOccupancy,
    potentialRevenueLoss: range.potentialRevenueLoss,
    recommendation: generateRecommendation(range, reservations, totalSites),
  }));
}

/**
 * Confidence level for a specific forecast date
 * @param {Array} forecast - Forecast array from forecastOccupancy
 * @param {string} date - Target date (YYYY-MM-DD)
 * @returns {Object} { confidence: 0-100, margin, lower, upper }
 */
export function getConfidenceForDate(forecast, date) {
  const day = forecast.find((d) => d.date === date);
  if (!day) return { confidence: 0, margin: 0, lower: 0, upper: 0 };

  // Confidence decreases as margin increases
  const confidence = Math.max(0, 100 - (day.confidenceMargin * 4));

  return {
    confidence: Math.round(confidence),
    margin: day.confidenceMargin,
    lower: day.confidenceLower,
    upper: day.confidenceUpper,
    forecast: day.forecastOccupancy,
  };
}

/**
 * Detect anomalies in booking patterns
 * @param {Array} reservations - All reservations
 * @param {number} lookbackDays - Historical window (default 90)
 * @returns {Array} Anomalies: unusual booking patterns
 */
export function detectAnomalies(reservations, lookbackDays = 90) {
  if (!reservations || reservations.length < 10) return [];

  const recentRes = reservations.filter((r) => {
    const createdAt = new Date(r.createdAt);
    const daysAgo = (new Date() - createdAt) / (1000 * 60 * 60 * 24);
    return daysAgo <= lookbackDays;
  });

  if (recentRes.length === 0) return [];

  // Calculate average booking metrics
  const avgNights = recentRes.reduce((sum, r) => sum + r.nights, 0) / recentRes.length;
  const avgTotal = recentRes.reduce((sum, r) => sum + r.totalCents, 0) / recentRes.length;

  const anomalies = [];

  for (const res of recentRes) {
    // Unusually long stays
    if (res.nights > avgNights * 2.5) {
      anomalies.push({
        type: 'unusually-long-stay',
        date: res.createdAt,
        details: `${res.nights} nights (avg: ${Math.round(avgNights)})`,
        severity: 'info',
      });
    }

    // Unusually high/low rates
    if (res.totalCents > avgTotal * 2) {
      anomalies.push({
        type: 'high-value-booking',
        date: res.createdAt,
        details: `$${(res.totalCents / 100).toFixed(2)} (avg: $${(avgTotal / 100).toFixed(2)})`,
        severity: 'success',
      });
    }

    if (res.totalCents < avgTotal * 0.5 && res.totalCents > 0) {
      anomalies.push({
        type: 'low-value-booking',
        date: res.createdAt,
        details: `$${(res.totalCents / 100).toFixed(2)} (avg: $${(avgTotal / 100).toFixed(2)})`,
        severity: 'warning',
      });
    }

    // Group bookings (multiple guests on same dates)
    const sameCheckIn = recentRes.filter((r2) => r2.checkIn === res.checkIn);
    if (sameCheckIn.length > 3) {
      anomalies.push({
        type: 'group-booking-surge',
        date: res.checkIn,
        details: `${sameCheckIn.length} bookings for same check-in`,
        severity: 'success',
      });
    }
  }

  return anomalies;
}

/* ================================================================ */
/* Helper Functions                                                  */
/* ================================================================ */

function getHistoricalOccupancy(reservations, totalSites, days = 365) {
  if (!Array.isArray(reservations) || totalSites <= 0) return [];

  const result = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    const bookedSites = countBookedSites(reservations, dateStr);
    const occupancy = (bookedSites / totalSites) * 100;

    result.push({
      date: dateStr,
      occupancy: occupancy,
      bookedSites,
      dayOfYear: getDayOfYear(currentDate),
    });
  }

  return result;
}

function countBookedSites(reservations, dateStr) {
  if (!Array.isArray(reservations)) return 0;

  const checkDate = new Date(dateStr);
  const bookedSites = new Set();

  for (const res of reservations) {
    if ((res.status === 'confirmed' || res.status === 'confirmed-deposit')) {
      const checkIn = new Date(res.checkIn);
      const checkOut = new Date(res.checkOut);

      if (checkIn <= checkDate && checkOut > checkDate) {
        bookedSites.add(res.siteId);
      }
    }
  }

  return bookedSites.size;
}

function extractSeasonalPattern(historicalDays) {
  const pattern = {};

  for (let doy = 1; doy <= 365; doy++) {
    pattern[doy] = 50; // Default middle value
  }

  // Group historical data by day of year and calculate average
  const byDayOfYear = {};
  for (const day of historicalDays) {
    if (!byDayOfYear[day.dayOfYear]) {
      byDayOfYear[day.dayOfYear] = [];
    }
    byDayOfYear[day.dayOfYear].push(day.occupancy);
  }

  for (const [doy, occupancies] of Object.entries(byDayOfYear)) {
    if (occupancies.length > 0) {
      const avg = occupancies.reduce((sum, o) => sum + o, 0) / occupancies.length;
      pattern[parseInt(doy)] = Math.max(0, Math.min(100, avg));
    }
  }

  return pattern;
}

function calculateTrend(historicalDays) {
  if (historicalDays.length < 7) {
    return { slope: 0, direction: 'stable' };
  }

  const regression = linearRegression(
    historicalDays.slice(-90).map((d, i) => ({
      x: i,
      y: d.occupancy,
    }))
  );

  return {
    slope: regression.slope,
    direction: regression.slope > 0.5 ? 'improving' : regression.slope < -0.5 ? 'declining' : 'stable',
  };
}

function calculateBookingPace(reservations, totalSites) {
  if (!Array.isArray(reservations) || totalSites <= 0) {
    return { currentPace: 100, direction: 'normal' };
  }

  // Average booking lead time (days between creation and check-in)
  const leadTimes = reservations
    .filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit')
    .map((r) => {
      const created = new Date(r.createdAt);
      const checkIn = new Date(r.checkIn);
      return Math.ceil((checkIn - created) / (1000 * 60 * 60 * 24));
    })
    .filter((lt) => lt > 0 && lt < 180); // Reasonable range

  if (leadTimes.length < 5) return { currentPace: 100, direction: 'normal' };

  const avgLeadTime = leadTimes.reduce((sum, lt) => sum + lt, 0) / leadTimes.length;

  // Recently booked vs 90 days ago booked
  const now = new Date();
  const recent = reservations.filter((r) => {
    const created = new Date(r.createdAt);
    const daysAgo = (now - created) / (1000 * 60 * 60 * 24);
    return daysAgo < 30 && (r.status === 'confirmed' || r.status === 'confirmed-deposit');
  });

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 120);
  const historical = reservations.filter((r) => {
    const created = new Date(r.createdAt);
    return created >= ninetyDaysAgo && created < ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() + 30) &&
      (r.status === 'confirmed' || r.status === 'confirmed-deposit');
  });

  const pace = historical.length > 0 ? (recent.length / historical.length) * 100 : 100;

  return {
    currentPace: Math.round(pace),
    direction: pace > 110 ? 'accelerating' : pace < 90 ? 'slowing' : 'normal',
    avgLeadDays: Math.round(avgLeadTime),
  };
}

function linearRegression(points) {
  if (points.length < 2) return { slope: 0, r2: 0 };

  const n = points.length;
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumX2 = points.reduce((sum, p) => sum + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R²
  const meanY = sumY / n;
  const ssRes = points.reduce((sum, p) => {
    const predicted = slope * p.x + intercept;
    return sum + Math.pow(p.y - predicted, 2);
  }, 0);
  const ssTot = points.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0);
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

  return { slope, intercept, r2: Math.max(0, Math.min(1, r2)) };
}

function getDayOfYear(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

function identifyUnderutilizedDateRanges(reservations, totalSites, daysToAnalyze, lowThreshold = 40) {
  const forecast = forecastOccupancy(reservations, totalSites, daysToAnalyze);
  const ranges = [];

  let rangeStart = null;
  let rangeDays = [];

  for (const day of forecast) {
    if (day.forecastOccupancy < lowThreshold) {
      if (!rangeStart) {
        rangeStart = day.date;
      }
      rangeDays.push(day);
    } else {
      if (rangeStart) {
        // End of range
        ranges.push({
          startDate: rangeStart,
          endDate: rangeDays[rangeDays.length - 1].date,
          nights: rangeDays.length,
          averageOccupancy: Math.round(
            rangeDays.reduce((sum, d) => sum + d.forecastOccupancy, 0) / rangeDays.length * 10
          ) / 10,
          potentialRevenueLoss: calculatePotentialRevenueLoss(rangeDays, totalSites),
        });
        rangeStart = null;
        rangeDays = [];
      }
    }
  }

  if (rangeStart) {
    ranges.push({
      startDate: rangeStart,
      endDate: rangeDays[rangeDays.length - 1].date,
      nights: rangeDays.length,
      averageOccupancy: Math.round(
        rangeDays.reduce((sum, d) => sum + d.forecastOccupancy, 0) / rangeDays.length * 10
      ) / 10,
      potentialRevenueLoss: calculatePotentialRevenueLoss(rangeDays, totalSites),
    });
  }

  return ranges.slice(0, 10); // Top 10 underutilized periods
}

function calculatePotentialRevenueLoss(rangeDays, totalSites, avgNightlyRate = 5000) {
  // Simplified: assume average nightly rate and calculate lost revenue
  const avgOccupancy = rangeDays.reduce((sum, d) => sum + d.forecastOccupancy, 0) / rangeDays.length;
  const potentialOccupancy = 85; // Target occupancy
  const lossPercent = Math.max(0, potentialOccupancy - avgOccupancy);
  const emptyNights = (lossPercent / 100) * rangeDays.length * totalSites;

  return Math.round(emptyNights * avgNightlyRate);
}

function generateRecommendation(range, reservations, totalSites) {
  const occupancyGap = 85 - range.averageOccupancy;

  if (occupancyGap < 10) {
    return 'Monitor closely; near target occupancy';
  } else if (occupancyGap < 25) {
    return 'Consider light discount (5-10%) or small promotion';
  } else if (occupancyGap < 50) {
    return 'Recommend promotional campaign or strategic discount (10-20%)';
  } else {
    return 'Urgent: Major campaign needed. Consider deep discount or special offer';
  }
}

function generateDefaultForecast(days) {
  const forecast = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i + 1);

    forecast.push({
      date: date.toISOString().split('T')[0],
      dayNumber: i + 1,
      forecastOccupancy: 50,
      confidenceLower: 35,
      confidenceUpper: 65,
      confidenceMargin: 15,
      season: detectSeason(date),
      trend: 'stable',
      components: {
        baseOccupancy: 50,
        seasonalInfluence: 50,
        trendInfluence: 50,
        paceInfluence: 50,
      },
    });
  }

  return forecast;
}
