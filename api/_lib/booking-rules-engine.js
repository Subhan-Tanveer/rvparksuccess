/**
 * Booking Rules Engine
 * Manages and validates booking rules including min/max stay, booking windows,
 * group size limits, blackout dates, cancellation policies, pet policies,
 * and seasonal rules.
 */

/**
 * Validate if a booking is allowed based on park rules
 * @param {Object} reservation - Booking details {checkIn, checkOut, siteId, parkId, guestCount}
 * @param {Object} store - Database store instance
 * @returns {Promise<{allowed: boolean, reasons: string[], warnings: string[]}>}
 */
export async function validateBooking(reservation, store) {
  const {
    checkIn,
    checkOut,
    siteId,
    parkId,
    guestCount = 1,
  } = reservation;

  const reasons = [];
  const warnings = [];

  // Convert dates to Date objects for comparison
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

  try {
    // Get all active rules for this park/site
    const rules = await store.getBookingRules(parkId, siteId);
    const activeRules = rules.filter((r) => r.is_active);

    // Check minimum stay
    const minStayRules = activeRules.filter((r) => r.rule_type === 'min_stay');
    for (const rule of minStayRules) {
      const config = JSON.parse(rule.rule_config_json);
      if (nights < config.nights) {
        reasons.push(
          `Minimum stay is ${config.nights} nights (this booking is ${nights} nights)`
        );
      }
    }

    // Check maximum stay
    const maxStayRules = activeRules.filter((r) => r.rule_type === 'max_stay');
    for (const rule of maxStayRules) {
      const config = JSON.parse(rule.rule_config_json);
      if (nights > config.nights) {
        reasons.push(
          `Maximum stay is ${config.nights} nights (this booking is ${nights} nights)`
        );
      }
    }

    // Check booking window (how far in advance can book)
    const bookingWindowRules = activeRules.filter((r) => r.rule_type === 'booking_window');
    for (const rule of bookingWindowRules) {
      const config = JSON.parse(rule.rule_config_json);
      const maxDaysAhead = config.days_in_advance || 180;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysAhead = Math.ceil((checkInDate - today) / (1000 * 60 * 60 * 24));

      if (daysAhead > maxDaysAhead) {
        reasons.push(
          `Can only book up to ${maxDaysAhead} days in advance (this booking is ${daysAhead} days ahead)`
        );
      }

      // Check minimum days before check-in
      if (config.min_days_before) {
        if (daysAhead < config.min_days_before) {
          reasons.push(`Must book at least ${config.min_days_before} days in advance`);
        }
      }
    }

    // Check group size limits
    const groupSizeRules = activeRules.filter((r) => r.rule_type === 'group_size');
    for (const rule of groupSizeRules) {
      const config = JSON.parse(rule.rule_config_json);
      if (config.min_people && guestCount < config.min_people) {
        reasons.push(`Minimum group size is ${config.min_people} people`);
      }
      if (config.max_people && guestCount > config.max_people) {
        reasons.push(`Maximum group size is ${config.max_people} people`);
      }
    }

    // Check blackout dates
    const blackoutDates = await store.getBlackoutDates(parkId, siteId);
    const blockedDateRanges = [];
    for (const blackout of blackoutDates) {
      const blackoutStart = new Date(blackout.start_date);
      const blackoutEnd = new Date(blackout.end_date);

      // Check if booking overlaps with blackout period
      if (checkInDate < blackoutEnd && checkOutDate > blackoutStart) {
        blockedDateRanges.push({
          start: blackout.start_date,
          end: blackout.end_date,
          reason: blackout.reason,
        });
      }
    }

    if (blockedDateRanges.length > 0) {
      const dateStr = blockedDateRanges
        .map((r) => `${r.start} to ${r.end}`)
        .join(', ');
      reasons.push(`Blackout dates overlap: ${dateStr}`);
    }

    // Check seasonal rules
    const seasonalRules = activeRules.filter((r) => r.rule_type === 'seasonal');
    for (const rule of seasonalRules) {
      const config = JSON.parse(rule.rule_config_json);
      if (isDateInSeason(checkInDate, config.season)) {
        // Apply seasonal restrictions
        if (config.weekends_only && !isWeekend(checkInDate)) {
          warnings.push(
            `Season "${config.season}" allows check-in on weekends only`
          );
        }
      }
    }

    // Collect all blocking reasons
    const allowed = reasons.length === 0;

    return { allowed, reasons, warnings };
  } catch (err) {
    console.error('[booking-rules-engine] validation error:', err);
    return { allowed: true, reasons: [], warnings: [] }; // Fail open
  }
}

/**
 * Calculate total booking cost including conditional pricing
 * @param {Object} dates - {checkIn, checkOut}
 * @param {Object} site - {nightly_rate_cents, ...}
 * @param {Object} store - Database store
 * @param {string} parkId
 * @returns {Promise<{nightly_rate: number, total_cost: number, breakdown: Array}>}
 */
export async function calculateBookingCost(dates, site, store, parkId) {
  const { checkIn, checkOut } = dates;
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

  const breakdown = [];
  let totalCost = 0;

  try {
    const rules = await store.getBookingRules(parkId, site.id);
    const seasonalRates = site.seasonalRates || [];

    // Iterate through each night
    for (let i = 0; i < nights; i++) {
      const nightDate = new Date(checkInDate);
      nightDate.setDate(nightDate.getDate() + i);

      let rate = site.nightly_rate_cents;

      // Apply seasonal modifiers
      for (const seasonal of seasonalRates) {
        const seasonStart = new Date(seasonal.start_date);
        const seasonEnd = new Date(seasonal.end_date);
        if (nightDate >= seasonStart && nightDate <= seasonEnd) {
          rate = seasonal.nightly_rate_cents;
          break;
        }
      }

      // Apply pricing rules
      const pricingRules = rules.filter((r) => r.rule_type === 'pricing');
      for (const rule of pricingRules) {
        const config = JSON.parse(rule.rule_config_json);
        if (isDateInSeason(nightDate, config.season)) {
          if (config.multiplier) {
            rate = Math.round(rate * config.multiplier);
          }
          if (config.fixed_rate_cents) {
            rate = config.fixed_rate_cents;
          }
        }
      }

      breakdown.push({
        date: nightDate.toISOString().split('T')[0],
        rate,
      });

      totalCost += rate;
    }

    return {
      nightly_rate: site.nightly_rate_cents,
      total_cost: totalCost,
      breakdown,
    };
  } catch (err) {
    console.error('[booking-rules-engine] cost calculation error:', err);
    return {
      nightly_rate: site.nightly_rate_cents,
      total_cost: nights * site.nightly_rate_cents,
      breakdown: [],
    };
  }
}

/**
 * Calculate refund based on cancellation policy
 * @param {Object} reservation - Reservation details
 * @param {Date} cancellationDate - When cancellation happens
 * @param {Object} store - Database store
 * @returns {Promise<{refund_cents: number, charge_cents: number, reason: string}>}
 */
export async function enforceCancellationPolicy(
  reservation,
  cancellationDate,
  store
) {
  const { park_id, total_cents, check_in } = reservation;

  try {
    const rules = await store.getBookingRules(park_id);
    const cancelRules = rules.filter((r) => r.rule_type === 'cancellation');

    if (cancelRules.length === 0) {
      // No rule = full refund
      return {
        refund_cents: total_cents,
        charge_cents: 0,
        reason: 'No cancellation policy',
      };
    }

    const policy = JSON.parse(cancelRules[0].rule_config_json);
    const checkInDate = new Date(check_in);
    const daysBeforeCheckIn = Math.ceil(
      (checkInDate - cancellationDate) / (1000 * 60 * 60 * 24)
    );

    // Find the applicable tier
    const tiers = policy.tiers || [];
    let refundPercent = 0;

    for (const tier of tiers) {
      if (daysBeforeCheckIn >= tier.days_before_checkin) {
        refundPercent = tier.refund_percent;
        break;
      }
    }

    const refund = Math.round(total_cents * (refundPercent / 100));
    const charge = total_cents - refund;

    return {
      refund_cents: refund,
      charge_cents: charge,
      reason: `${refundPercent}% refund (${daysBeforeCheckIn} days before check-in)`,
    };
  } catch (err) {
    console.error('[booking-rules-engine] cancellation calculation error:', err);
    return {
      refund_cents: total_cents,
      charge_cents: 0,
      reason: 'Error calculating refund',
    };
  }
}

/**
 * Get available dates for booking
 * @param {string} siteId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {Object} store
 * @returns {Promise<{available: string[], unavailable: string[]}>}
 */
export async function getAvailableDates(
  siteId,
  startDate,
  endDate,
  store
) {
  const available = [];
  const unavailable = [];

  try {
    const reservations = await store.getReservationsBySiteInRange(
      siteId,
      startDate,
      endDate
    );
    const blackouts = await store.getBlackoutDatesByDateRange(
      siteId,
      startDate,
      endDate
    );

    // Create a set of all unavailable dates
    const unavailableDates = new Set();

    // Add reservation dates
    for (const res of reservations) {
      const resStart = new Date(res.check_in);
      const resEnd = new Date(res.check_out);
      for (
        let d = new Date(resStart);
        d < resEnd;
        d.setDate(d.getDate() + 1)
      ) {
        unavailableDates.add(d.toISOString().split('T')[0]);
      }
    }

    // Add blackout dates
    for (const blackout of blackouts) {
      const blackoutStart = new Date(blackout.start_date);
      const blackoutEnd = new Date(blackout.end_date);
      for (
        let d = new Date(blackoutStart);
        d <= blackoutEnd;
        d.setDate(d.getDate() + 1)
      ) {
        unavailableDates.add(d.toISOString().split('T')[0]);
      }
    }

    // Classify all dates in range
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (unavailableDates.has(dateStr)) {
        unavailable.push(dateStr);
      } else {
        available.push(dateStr);
      }
    }

    return { available, unavailable };
  } catch (err) {
    console.error('[booking-rules-engine] availability error:', err);
    return { available: [], unavailable: [] };
  }
}

/**
 * Check if a date falls within a season
 * @param {Date} date
 * @param {string} season - "spring", "summer", "fall", "winter"
 * @returns {boolean}
 */
function isDateInSeason(date, season) {
  const month = date.getMonth() + 1; // 1-12

  const seasons = {
    spring: [3, 4, 5],
    summer: [6, 7, 8],
    fall: [9, 10, 11],
    winter: [12, 1, 2],
  };

  return seasons[season]?.includes(month) || false;
}

/**
 * Check if a date is a weekend
 * @param {Date} date
 * @returns {boolean}
 */
function isWeekend(date) {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

/**
 * Apply seasonal modifiers to rate
 * @param {Date} date
 * @param {Object} rules
 * @returns {number} multiplier (1.0 = no change)
 */
export function applySeasonalModifiers(date, rules) {
  for (const rule of rules) {
    if (rule.rule_type === 'seasonal') {
      const config = JSON.parse(rule.rule_config_json);
      if (isDateInSeason(date, config.season)) {
        return config.multiplier || 1.0;
      }
    }
  }
  return 1.0;
}

/**
 * Check if a rule conflicts with existing rules
 * @param {Object} newRule - New rule to check
 * @param {Array} existingRules - Existing rules
 * @returns {{hasConflict: boolean, conflicts: string[]}}
 */
export function checkRuleConflicts(newRule, existingRules) {
  const conflicts = [];

  // Min/max stay conflict
  if (newRule.rule_type === 'min_stay') {
    const maxRules = existingRules.filter((r) => r.rule_type === 'max_stay');
    for (const maxRule of maxRules) {
      const maxConfig = JSON.parse(maxRule.rule_config_json);
      const newConfig = JSON.parse(newRule.rule_config_json);
      if (newConfig.nights > maxConfig.nights) {
        conflicts.push(
          `Minimum stay (${newConfig.nights}) exceeds maximum stay (${maxConfig.nights})`
        );
      }
    }
  }

  if (newRule.rule_type === 'max_stay') {
    const minRules = existingRules.filter((r) => r.rule_type === 'min_stay');
    for (const minRule of minRules) {
      const minConfig = JSON.parse(minRule.rule_config_json);
      const newConfig = JSON.parse(newRule.rule_config_json);
      if (newConfig.nights < minConfig.nights) {
        conflicts.push(
          `Maximum stay (${newConfig.nights}) is less than minimum stay (${minConfig.nights})`
        );
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}
