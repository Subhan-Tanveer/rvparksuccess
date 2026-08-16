// Dynamic pricing engine for RV park reservations
// Calculates optimal nightly rates based on demand, occupancy, seasonality, and booking window

const DEFAULT_CONFIG = {
  occupancyThreshold: 80,          // >80% occupancy triggers price increase
  occupancyMultiplier: {
    low: 1.0,                      // <=50% occupancy
    medium: 1.05,                  // 50-80% occupancy
    high: 1.15,                    // 80-90% occupancy
    veryHigh: 1.25,                // >90% occupancy
  },
  windowMultiplier: {
    // Days until arrival: exponential curve favors last-minute bookings
    // More than 60 days out: 0.90x (advanced bookings get discount)
    // 30-60 days: 1.0x (baseline)
    // 14-30 days: 1.05x (closer = higher)
    // 7-14 days: 1.10x
    // 3-7 days: 1.15x
    // 0-3 days: 1.25x (last-minute premium)
  },
  seasonMultiplier: {
    peak: 1.3,                     // High season (holidays, summer)
    shoulder: 1.1,                 // Transition periods
    offSeason: 0.85,               // Low season
  },
  dayOfWeekMultiplier: {
    sunday: 1.15,
    monday: 1.0,
    tuesday: 1.0,
    wednesday: 1.0,
    thursday: 1.0,
    friday: 1.1,
    saturday: 1.2,
  },
  priceFloor: 0.8,                 // Never drop below 80% of base rate
  priceCeiling: 1.5,               // Never exceed 150% of base rate
  minPriceChangeWindow: 48,        // Don't change prices within 48 hours of arrival
  requireApprovalDays: 30,         // Require manual approval for first 30 days of future bookings
};

// Determine which season a date falls into (peak, shoulder, or off-season)
function getSeasonMultiplier(date, peakDateRanges = []) {
  // Peak season: July-August, holidays (Dec 20 - Jan 2, Thanksgiving week)
  // Shoulder: June, September
  // Off-season: Jan-May, Oct-Nov
  const month = date.getMonth() + 1; // 1-12
  const dayOfMonth = date.getDate();

  // Check custom peak date ranges first
  for (const range of peakDateRanges) {
    const rangeStart = new Date(range.startDate);
    const rangeEnd = new Date(range.endDate);
    if (date >= rangeStart && date < rangeEnd) {
      return DEFAULT_CONFIG.seasonMultiplier.peak;
    }
  }

  // Default peak seasons
  if ((month === 7 || month === 8) || // July-August
      (month === 12 && dayOfMonth >= 20) || // Dec 20-31
      (month === 1 && dayOfMonth <= 2) || // Jan 1-2
      (month === 11 && dayOfMonth >= 23 && dayOfMonth <= 28)) { // Thanksgiving week (approx)
    return DEFAULT_CONFIG.seasonMultiplier.peak;
  }

  // Shoulder season
  if (month === 6 || month === 9) {
    return DEFAULT_CONFIG.seasonMultiplier.shoulder;
  }

  // Off-season
  return DEFAULT_CONFIG.seasonMultiplier.offSeason;
}

// Determine multiplier based on days until arrival (booking window)
function getWindowMultiplier(daysUntilArrival) {
  if (daysUntilArrival > 60) return 0.90;
  if (daysUntilArrival > 30) return 1.0;
  if (daysUntilArrival > 14) return 1.05;
  if (daysUntilArrival > 7) return 1.10;
  if (daysUntilArrival > 3) return 1.15;
  return 1.25; // Last-minute premium (0-3 days)
}

// Determine occupancy-based multiplier — tiers are relative to the park's
// own occupancy target, not a fixed 80%, so a park aiming for 60% starts
// raising prices earlier (they're comfortable being fuller), and one
// aiming for 95% only raises once nearly sold out. Previously this used a
// hardcoded 80/90/50 split and ignored occupancyTargetPercent entirely,
// which was the only reason that dashboard setting didn't do anything.
function getOccupancyMultiplier(occupancyPercent, targetPercent = DEFAULT_CONFIG.occupancyThreshold) {
  if (occupancyPercent >= targetPercent + 10) return DEFAULT_CONFIG.occupancyMultiplier.veryHigh;
  if (occupancyPercent >= targetPercent) return DEFAULT_CONFIG.occupancyMultiplier.high;
  if (occupancyPercent >= targetPercent - 30) return DEFAULT_CONFIG.occupancyMultiplier.medium;
  return DEFAULT_CONFIG.occupancyMultiplier.low;
}

// Get day-of-week multiplier (weekend premium)
function getDayOfWeekMultiplier(date) {
  const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return DEFAULT_CONFIG.dayOfWeekMultiplier[dayNames[dayOfWeek]];
}

// Calculate confidence score (0-100) based on data quality
function calculateConfidence(occupancyData, daysUntilArrival, hasHistoricalData = false) {
  let confidence = 50; // Base confidence

  // More historical data = higher confidence
  if (hasHistoricalData) confidence += 20;

  // Higher occupancy data = more signal
  if (occupancyData && occupancyData.historicalAverage !== undefined) {
    confidence += 20;
  }

  // Confidence decreases for dates far in future (less predictable)
  if (daysUntilArrival > 30) confidence -= 10;

  // Confidence increases for dates within 30 days (more stable)
  if (daysUntilArrival <= 30 && daysUntilArrival >= 0) confidence += 10;

  return Math.min(100, Math.max(0, confidence));
}

// Main pricing calculation
export function calculatePrice({
  baseRateCents,
  checkInDate,
  siteOccupancyPercent = 50,
  currentOccupancyPercent = 0,
  siteModifier = 1.0,
  peakDateRanges = [],
  historicalData = null,
  occupancyTargetPercent = DEFAULT_CONFIG.occupancyThreshold,
}) {
  if (!baseRateCents || baseRateCents <= 0) {
    throw new Error('Base rate must be positive');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn = new Date(checkInDate);
  checkIn.setHours(0, 0, 0, 0);

  const daysUntilArrival = Math.floor((checkIn - today) / (1000 * 60 * 60 * 24));

  // Apply multipliers in sequence
  let priceMultiplier = 1.0;

  // Occupancy multiplier (current occupancy on that date, relative to the
  // park's own occupancy target)
  const occupancyMult = getOccupancyMultiplier(siteOccupancyPercent, occupancyTargetPercent);
  priceMultiplier *= occupancyMult;

  // Booking window multiplier (how far in advance)
  const windowMult = getWindowMultiplier(daysUntilArrival);
  priceMultiplier *= windowMult;

  // Seasonality multiplier
  const seasonMult = getSeasonMultiplier(checkIn, peakDateRanges);
  priceMultiplier *= seasonMult;

  // Day-of-week multiplier (weekend premium)
  const dayMult = getDayOfWeekMultiplier(checkIn);
  priceMultiplier *= dayMult;

  // Site-level modifier (0.8 - 1.2 for special sites)
  priceMultiplier *= siteModifier;

  // Apply bounds
  const minMultiplier = DEFAULT_CONFIG.priceFloor;
  const maxMultiplier = DEFAULT_CONFIG.priceCeiling;
  priceMultiplier = Math.max(minMultiplier, Math.min(maxMultiplier, priceMultiplier));

  const suggestedCents = Math.round(baseRateCents * priceMultiplier);
  const confidence = calculateConfidence(
    { historicalAverage: currentOccupancyPercent },
    daysUntilArrival,
    !!historicalData
  );

  const reasoning = {
    baseRate: `$${(baseRateCents / 100).toFixed(2)}`,
    occupancyFactor: `${siteOccupancyPercent}% occupancy vs ${occupancyTargetPercent}% target → ${(occupancyMult * 100).toFixed(0)}%`,
    bookingWindow: `${daysUntilArrival} days out → ${(windowMult * 100).toFixed(0)}%`,
    seasonality: `${seasonMult >= DEFAULT_CONFIG.seasonMultiplier.peak ? 'peak' : seasonMult >= DEFAULT_CONFIG.seasonMultiplier.shoulder ? 'shoulder' : 'off-season'} season → ${(seasonMult * 100).toFixed(0)}%`,
    dayOfWeek: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][checkIn.getDay()]} → ${(dayMult * 100).toFixed(0)}%`,
    siteModifier: siteModifier !== 1.0 ? `${(siteModifier * 100).toFixed(0)}%` : 'standard',
    finalMultiplier: `${(priceMultiplier * 100).toFixed(0)}%`,
  };

  return {
    suggestedCents,
    priceMultiplier: Number((priceMultiplier).toFixed(2)),
    confidence,
    reasoning,
  };
}

// Batch calculate prices for multiple dates/sites
export function calculatePricesForDateRange({
  baseRateCents,
  checkInDate,
  checkOutDate,
  dailyOccupancyPercents = {},
  siteModifier = 1.0,
  peakDateRanges = [],
}) {
  const prices = [];
  const current = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  while (current < checkOut) {
    const dateStr = current.toISOString().split('T')[0];
    const occupancy = dailyOccupancyPercents[dateStr] || 50;

    const result = calculatePrice({
      baseRateCents,
      checkInDate: dateStr,
      siteOccupancyPercent: occupancy,
      siteModifier,
      peakDateRanges,
    });

    prices.push({
      date: dateStr,
      occupancyPercent: occupancy,
      suggestedCents: result.suggestedCents,
      multiplier: result.priceMultiplier,
      confidence: result.confidence,
    });

    current.setDate(current.getDate() + 1);
  }

  return prices;
}

// Analyze pricing impact: what if we followed these suggestions?
// Projects revenue impact across every night in the suggested-prices set —
// i.e. "if all this available inventory sold at the suggested rate instead
// of the current rate." Deliberately NOT limited to nights that already
// have a reservation: for a date range with few or no existing bookings
// (the common case when an owner is checking suggestions before they
// happen), that would report $0/0% even when every suggested rate is
// higher than current, which reads as broken rather than "nothing booked
// yet in this range." Bookings that do exist are still reflected, since
// the site's current rate is what they were charged.
export function analyzePricingImpact(suggestedPrices) {
  if (!suggestedPrices.length) return { potentialRevenueCents: 0, percentageGain: 0 };

  let currentRevenueTotal = 0;
  let potentialRevenueTotal = 0;

  for (const suggestion of suggestedPrices) {
    currentRevenueTotal += suggestion.currentRate;
    potentialRevenueTotal += suggestion.suggestedRate;
  }

  const potentialRevenueCents = potentialRevenueTotal - currentRevenueTotal;
  const percentageGain = currentRevenueTotal > 0
    ? Math.round((potentialRevenueCents / currentRevenueTotal) * 1000) / 10
    : 0;

  return {
    potentialRevenueCents,
    percentageGain,
    currentRevenueTotal,
    potentialRevenueTotal,
  };
}

// Format pricing result for display
export function formatPricingResult(result) {
  return {
    suggestedPrice: `$${(result.suggestedCents / 100).toFixed(2)}`,
    multiplier: `${(result.priceMultiplier * 100).toFixed(0)}%`,
    confidence: `${result.confidence}%`,
    reasoning: result.reasoning,
  };
}

export const pricingConfig = DEFAULT_CONFIG;
