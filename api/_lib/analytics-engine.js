// Advanced Analytics Engine — core calculations for revenue, occupancy,
// guests, trends, forecasting, and segmentation. All pure functions that
// operate on already-fetched reservation data — no DB queries here, just
// calculations. This lets the API layer choose how to fetch (cache, range,
// etc.) and keeps the math isolated and testable.

/**
 * Calculate revenue metrics for a given period
 * @param {Array} reservations - Array of reservation objects
 * @param {Object} park - Park object (for tax rates, fees, etc.)
 * @returns {Object} Revenue metrics
 */
export function calculateRevenueMetrics(reservations, park = {}) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  const totalRevenueCents = confirmed.reduce((sum, r) => {
    return sum + (r.status === 'confirmed-deposit' ? r.depositCents : r.totalCents);
  }, 0);

  const totalRoomRevenueCents = confirmed.reduce((sum, r) => sum + r.subtotalCents, 0);
  const totalTaxCents = confirmed.reduce((sum, r) => sum + r.taxCents, 0);
  const totalFeeCents = confirmed.reduce((sum, r) => sum + r.feeCents, 0);
  const totalDiscountCents = confirmed.reduce((sum, r) => sum + r.discountCents, 0);

  const totalNights = confirmed.reduce((sum, r) => sum + r.nights, 0);
  const revenueCentsPerNight = totalNights > 0 ? Math.round(totalRevenueCents / totalNights) : 0;

  // Average daily rate = room revenue / nights (not including tax/fees)
  const adrCents = totalNights > 0 ? Math.round(totalRoomRevenueCents / totalNights) : 0;

  return {
    totalRevenueCents,
    totalRoomRevenueCents,
    totalTaxCents,
    totalFeeCents,
    totalDiscountCents,
    totalNights,
    adrCents,
    revenueCentsPerNight,
    bookingCount: confirmed.length,
  };
}

/**
 * Calculate occupancy metrics for a date range
 * @param {Array} reservations - Reservation objects
 * @param {number} siteCount - Total number of sites in the park
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object} Occupancy metrics
 */
export function calculateOccupancyMetrics(reservations, siteCount, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Calculate total possible site-nights
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const totalSiteNights = siteCount * daysDiff;

  // Calculate booked site-nights (accounting for partial overlaps)
  let bookedSiteNights = 0;
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  for (const res of confirmed) {
    const resStart = new Date(res.checkIn);
    const resEnd = new Date(res.checkOut);

    // Find overlap between reservation and date range
    const overlapStart = new Date(Math.max(start.getTime(), resStart.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), resEnd.getTime()));

    if (overlapEnd > overlapStart) {
      const overlapDays = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
      bookedSiteNights += overlapDays;
    }
  }

  const occupancyPercent = totalSiteNights > 0 ? Math.round((bookedSiteNights / totalSiteNights) * 1000) / 10 : 0;

  return {
    occupancyPercent,
    bookedSiteNights,
    totalSiteNights,
    daysDiff,
  };
}

/**
 * Calculate guest metrics
 * @param {Array} reservations - Reservation objects
 * @returns {Object} Guest metrics
 */
export function calculateGuestMetrics(reservations) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  // Count unique guests by email
  const uniqueGuestEmails = new Set(
    confirmed
      .filter((r) => r.guestEmail && r.guestEmail.trim())
      .map((r) => r.guestEmail.toLowerCase().trim())
  );

  const uniqueGuestCount = uniqueGuestEmails.size;

  // Find repeat guests (guests with >1 booking)
  const emailCounts = {};
  for (const res of confirmed) {
    if (res.guestEmail && res.guestEmail.trim()) {
      const email = res.guestEmail.toLowerCase().trim();
      emailCounts[email] = (emailCounts[email] || 0) + 1;
    }
  }

  const repeatGuestEmails = Object.entries(emailCounts).filter(([_, count]) => count > 1).map(([email]) => email);
  const repeatGuestPercent =
    uniqueGuestCount > 0 ? Math.round((repeatGuestEmails.length / uniqueGuestCount) * 1000) / 10 : 0;

  // Calculate average stay length
  const totalNights = confirmed.reduce((sum, r) => sum + r.nights, 0);
  const avgStayNights = confirmed.length > 0 ? Math.round((totalNights / confirmed.length) * 10) / 10 : 0;

  // Cancellation rate (canceled vs total)
  const allReservations = reservations;
  const canceledCount = allReservations.filter((r) => r.status === 'canceled').length;
  const cancellationPercent =
    allReservations.length > 0 ? Math.round((canceledCount / allReservations.length) * 1000) / 10 : 0;

  return {
    uniqueGuestCount,
    repeatGuestCount: repeatGuestEmails.length,
    repeatGuestPercent,
    avgStayNights,
    cancellationPercent,
    totalBookings: confirmed.length,
  };
}

/**
 * Calculate trends (comparing periods)
 * @param {Array} current - Current period reservations
 * @param {Array} previous - Previous period reservations
 * @param {number} siteCount - Site count
 * @param {string} currentStart - Current period start date
 * @param {string} currentEnd - Current period end date
 * @param {string} previousStart - Previous period start date
 * @param {string} previousEnd - Previous period end date
 * @returns {Object} Trend analysis
 */
export function calculateTrends(current, previous, siteCount, currentStart, currentEnd, previousStart, previousEnd) {
  const currentRevenue = calculateRevenueMetrics(current);
  const previousRevenue = calculateRevenueMetrics(previous);

  const currentOccupancy = calculateOccupancyMetrics(current, siteCount, currentStart, currentEnd);
  const previousOccupancy = calculateOccupancyMetrics(previous, siteCount, previousStart, previousEnd);

  const revenueTrend = previousRevenue.totalRevenueCents > 0
    ? Math.round(((currentRevenue.totalRevenueCents - previousRevenue.totalRevenueCents) / previousRevenue.totalRevenueCents) * 1000) / 10
    : 0;

  const occupancyTrend = Math.round((currentOccupancy.occupancyPercent - previousOccupancy.occupancyPercent) * 10) / 10;

  const bookingsTrend = previousRevenue.bookingCount > 0
    ? Math.round(((currentRevenue.bookingCount - previousRevenue.bookingCount) / previousRevenue.bookingCount) * 1000) / 10
    : 0;

  const adrTrend = previousRevenue.adrCents > 0
    ? Math.round(((currentRevenue.adrCents - previousRevenue.adrCents) / previousRevenue.adrCents) * 1000) / 10
    : 0;

  return {
    revenueTrendPercent: revenueTrend,
    occupancyTrendPercent: occupancyTrend,
    bookingsTrendPercent: bookingsTrend,
    adrTrendPercent: adrTrend,
    currentRevenue,
    previousRevenue,
  };
}

/**
 * Calculate daily revenue for charting
 * @param {Array} reservations - Reservation objects
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Array} Array of {date, revenue} objects
 */
export function calculateDailyRevenue(reservations, startDate, endDate) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');
  const dailyRevenue = {};

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Initialize all days to 0 — end date is inclusive (it's "today", not an
  // exclusive upper bound), otherwise a check-in on the very last day of
  // the range (the most common case: someone booking for a same-day or
  // near-term stay) has no bucket to land in at all.
  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().split('T')[0];
    dailyRevenue[dateStr] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }

  // Distribute revenue across check-in dates
  for (const res of confirmed) {
    const checkInDate = res.checkIn;
    if (checkInDate >= startDate && checkInDate <= endDate) {
      const perNightCents = res.subtotalCents / res.nights;
      dailyRevenue[checkInDate] = (dailyRevenue[checkInDate] || 0) + Math.round(perNightCents);
    }
  }

  return Object.entries(dailyRevenue).map(([date, revenue]) => ({ date, revenueCents: revenue }));
}

/**
 * Calculate per-site metrics
 * @param {Array} reservations - Reservation objects
 * @param {Array} sites - Site objects
 * @returns {Array} Per-site metrics
 */
export function calculatePerSiteMetrics(reservations, sites) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  return sites.map((site) => {
    const siteReservations = confirmed.filter((r) => r.siteId === site.id);
    const revenue = calculateRevenueMetrics(siteReservations, {});

    return {
      siteId: site.id,
      siteName: site.name,
      siteType: site.type,
      bookingCount: siteReservations.length,
      totalRevenueCents: revenue.totalRevenueCents,
      totalNights: revenue.totalNights,
      adrCents: revenue.adrCents,
    };
  });
}

/**
 * Calculate booking source breakdown
 * @param {Array} reservations - Reservation objects
 * @returns {Object} Source breakdown
 */
export function calculateBookingSourceMetrics(reservations) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  const sourceCounts = {};
  const sourceRevenue = {};

  for (const res of confirmed) {
    const source = res.source || 'unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    sourceRevenue[source] = (sourceRevenue[source] || 0) + (res.status === 'confirmed-deposit' ? res.depositCents : res.totalCents);
  }

  const total = confirmed.length;
  return Object.entries(sourceCounts).map(([source, count]) => ({
    source,
    bookingCount: count,
    bookingPercent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    totalRevenueCents: sourceRevenue[source] || 0,
  }));
}

/**
 * Simple forecasting based on recent booking velocity
 * @param {Array} reservations - Recent reservations
 * @param {number} parkAdrCents - Park's ADR
 * @param {number} forecastDays - Days to forecast
 * @param {number} confidence - Confidence interval (0-1)
 * @returns {Object} Forecast data
 */
export function calculateForecast(reservations, parkAdrCents, forecastDays = 30, confidence = 0.9, occupancyRate = 1) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  // Average rate charged per booked night over the past period
  const avgNightlyRevenue = confirmed.length > 0 ? confirmed.reduce((sum, r) => sum + (r.subtotalCents / r.nights), 0) / confirmed.length : 0;

  // Rate x forecastDays alone assumes every single night sells — occupancyRate
  // (actual booked-nights / available-nights over the historical window) scales
  // that down to something closer to "what you'll likely actually collect."
  // A park with a strong nightly rate but only a handful of real bookings so
  // far previously forecasted as if it were booked solid for the next month.
  const predictedRevenueCents = Math.round(avgNightlyRevenue * forecastDays * Math.max(0, Math.min(1, occupancyRate)));

  // Confidence interval (simplified: ±20% based on historical variance)
  const variance = 0.2;
  const lowerBoundCents = Math.round(predictedRevenueCents * (1 - variance));
  const upperBoundCents = Math.round(predictedRevenueCents * (1 + variance));

  return {
    forecastDays,
    predictedRevenueCents,
    lowerBoundCents,
    upperBoundCents,
    confidencePercent: Math.round(confidence * 100),
  };
}

/**
 * Calculate occupancy heatmap data (sites x dates)
 * @param {Array} reservations - Reservation objects
 * @param {Array} sites - Site objects
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object} Heatmap data
 */
export function calculateOccupancyHeatmap(reservations, sites, startDate, endDate) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  const heatmapData = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (const site of sites) {
    const siteRow = { siteId: site.id, siteName: site.name, dates: {} };

    // For each day, check if this site is booked — end date inclusive,
    // same reasoning as calculateDailyRevenue above.
    const cursor = new Date(start);
    while (cursor <= end) {
      const dateStr = cursor.toISOString().split('T')[0];
      const nextDay = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);

      const isBooked = confirmed.some((r) => r.siteId === site.id && new Date(r.checkIn) < nextDay && new Date(r.checkOut) > cursor);

      siteRow.dates[dateStr] = isBooked ? 100 : 0;
      cursor.setDate(cursor.getDate() + 1);
    }

    heatmapData.push(siteRow);
  }

  return heatmapData;
}

/**
 * Calculate top guests
 * @param {Array} reservations - Reservation objects
 * @param {number} limit - How many top guests to return
 * @returns {Array} Top guest data
 */
export function calculateTopGuests(reservations, limit = 10) {
  const confirmed = reservations.filter((r) => r.status === 'confirmed' || r.status === 'confirmed-deposit');

  const guestData = {};

  for (const res of confirmed) {
    if (!res.guestEmail || !res.guestEmail.trim()) continue;

    const email = res.guestEmail.toLowerCase().trim();
    if (!guestData[email]) {
      guestData[email] = {
        guestEmail: res.guestEmail,
        guestName: res.guestName,
        bookingCount: 0,
        totalNights: 0,
        totalRevenueCents: 0,
        lastBookingDate: res.checkIn,
      };
    }

    guestData[email].bookingCount += 1;
    guestData[email].totalNights += res.nights;
    guestData[email].totalRevenueCents += res.status === 'confirmed-deposit' ? res.depositCents : res.totalCents;
    if (res.checkIn > guestData[email].lastBookingDate) {
      guestData[email].lastBookingDate = res.checkIn;
    }
  }

  return Object.values(guestData)
    .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents)
    .slice(0, limit);
}
