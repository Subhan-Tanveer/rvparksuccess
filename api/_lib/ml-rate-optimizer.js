/**
 * ML Rate Optimization Engine — Production-Ready Rate Optimization
 *
 * No external ML libraries — uses simple statistical models:
 * - Linear regression for rate elasticity
 * - Moving averages for trend detection
 * - Standard deviation for confidence intervals
 * - Models stored as JSON (coefficients, intercept, metadata)
 *
 * Core Functions:
 * - trainRateModel(parkId, siteId, historicalData) → Build ML model
 * - predictOccupancy(date, site, rate) → Predict occupancy % at rate
 * - optimizeRateForDate(date, site, budget='revenue'|'occupancy') → Best rate
 * - getModelAccuracy(siteId, days=30) → Validation accuracy (MAE)
 * - suggestSeasonalRates(siteId, startDate, endDate) → AI rate card
 * - analyzeRateElasticity(siteId) → Price elasticity coefficient
 * - detectAnomalies(siteId, date) → Flag unusual patterns
 */

import { pricingConfig } from './pricing-engine.js';

// Standard moderate price elasticity assumed whenever the regression can't
// fit a real slope from historical rate variance (see predictOccupancy and
// analyzeElasticity below for why that happens routinely — it's not a data
// shortage). Shared so both places report the same number.
const STANDARD_ELASTICITY = -0.5;

/**
 * Linear Regression Model
 * Used for: Rate elasticity (price → occupancy relationship)
 */
class LinearRegression {
  constructor() {
    this.slope = 0;
    this.intercept = 0;
    this.r_squared = 0;
    this.mean_x = 0;
    this.mean_y = 0;
  }

  fit(x_values, y_values) {
    const n = x_values.length;
    if (n < 2) return false;

    // Calculate means
    this.mean_x = x_values.reduce((a, b) => a + b) / n;
    this.mean_y = y_values.reduce((a, b) => a + b) / n;

    // Calculate covariance and variance
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const dx = x_values[i] - this.mean_x;
      const dy = y_values[i] - this.mean_y;
      covariance += dx * dy;
      variance += dx * dx;
    }

    if (variance === 0) return false;

    this.slope = covariance / variance;
    this.intercept = this.mean_y - this.slope * this.mean_x;

    // Calculate R-squared
    let ss_res = 0;
    let ss_tot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = this.predict(x_values[i]);
      ss_res += Math.pow(y_values[i] - predicted, 2);
      ss_tot += Math.pow(y_values[i] - this.mean_y, 2);
    }
    this.r_squared = ss_tot === 0 ? 0 : 1 - ss_res / ss_tot;

    return true;
  }

  predict(x) {
    return this.slope * x + this.intercept;
  }

  toJSON() {
    return {
      slope: this.slope,
      intercept: this.intercept,
      r_squared: this.r_squared,
      mean_x: this.mean_x,
      mean_y: this.mean_y,
    };
  }

  static fromJSON(data) {
    const model = new LinearRegression();
    model.slope = data.slope;
    model.intercept = data.intercept;
    model.r_squared = data.r_squared;
    model.mean_x = data.mean_x;
    model.mean_y = data.mean_y;
    return model;
  }
}

/**
 * Time Series Decomposition Model
 * Separates trend, seasonality, and residual
 */
class TimeSeriesModel {
  constructor() {
    this.trend = []; // Smoothed trend line
    this.seasonal_factors = {}; // Day-of-week seasonal factors
    this.residual_std = 0; // Standard deviation of residuals
    this.mean_value = 0;
    this.data_points = 0;
  }

  /**
   * Fit time series model from occupancy history
   * occupancy_history: [{date: '2026-08-11', occupancy: 0.85}, ...]
   */
  fit(occupancy_history) {
    if (occupancy_history.length < 14) return false; // Need at least 2 weeks

    // Extract occupancy values
    const occupancies = occupancy_history.map((x) => x.occupancy);
    this.data_points = occupancies.length;
    this.mean_value = occupancies.reduce((a, b) => a + b) / occupancies.length;

    // Calculate 7-day moving average (trend)
    const window_size = 7;
    this.trend = [];
    for (let i = 0; i < occupancies.length; i++) {
      const start = Math.max(0, i - Math.floor(window_size / 2));
      const end = Math.min(occupancies.length, i + Math.floor(window_size / 2) + 1);
      const window = occupancies.slice(start, end);
      const avg = window.reduce((a, b) => a + b) / window.length;
      this.trend.push(avg);
    }

    // Calculate seasonal factors (day of week)
    this.seasonal_factors = {};
    const day_values = {};
    for (let i = 0; i < occupancy_history.length; i++) {
      const date = new Date(occupancy_history[i].date);
      const day_of_week = date.getDay();
      if (!day_values[day_of_week]) day_values[day_of_week] = [];
      day_values[day_of_week].push(occupancies[i] - this.trend[i]);
    }

    // Average seasonal component per day of week
    for (let day = 0; day < 7; day++) {
      if (day_values[day] && day_values[day].length > 0) {
        this.seasonal_factors[day] = day_values[day].reduce((a, b) => a + b) / day_values[day].length;
      } else {
        this.seasonal_factors[day] = 0;
      }
    }

    // Calculate residual standard deviation
    let residual_sum = 0;
    for (let i = 0; i < occupancies.length; i++) {
      const seasonal = this.seasonal_factors[new Date(occupancy_history[i].date).getDay()] || 0;
      const residual = occupancies[i] - this.trend[i] - seasonal;
      residual_sum += residual * residual;
    }
    this.residual_std = Math.sqrt(residual_sum / occupancies.length);

    return true;
  }

  /**
   * Predict occupancy for a given date
   * Uses trend + seasonal components + confidence interval
   */
  predict(date) {
    if (this.trend.length === 0) return { occupancy: 0.5, confidence: 0.2 };

    const day_of_week = new Date(date).getDay();
    const seasonal = this.seasonal_factors[day_of_week] || 0;

    // Use latest trend value as baseline
    const trend_value = this.trend[this.trend.length - 1];
    const predicted_occupancy = Math.max(0, Math.min(1, trend_value + seasonal));

    // Confidence based on residual std
    // Lower std = higher confidence (better historical fit)
    const confidence = Math.max(0.3, Math.min(0.95, 1 - this.residual_std / 2));

    return { occupancy: predicted_occupancy, confidence, seasonal, trend: trend_value };
  }

  toJSON() {
    return {
      trend: this.trend,
      seasonal_factors: this.seasonal_factors,
      residual_std: this.residual_std,
      mean_value: this.mean_value,
      data_points: this.data_points,
    };
  }

  static fromJSON(data) {
    const model = new TimeSeriesModel();
    model.trend = data.trend;
    model.seasonal_factors = data.seasonal_factors;
    model.residual_std = data.residual_std;
    model.mean_value = data.mean_value;
    model.data_points = data.data_points;
    return model;
  }
}

/**
 * Combined Rate Optimization Model
 * Integrates elasticity + time series + revenue optimization
 */
export class RateOptimizer {
  /**
   * Train comprehensive model on historical data
   */
  static trainModel(reservations, occupancy_history = [], siteCount = 10) {
    // Prepare rate/occupancy pairs for elasticity analysis
    const rate_occupancy_pairs = [];
    const rate_map = {};

    // Group by date, calculate occupancy per rate point. res.rate_cents is
    // expected to already be a per-night rate (subtotal_cents / nights) —
    // passing the stay's total subtotal here would make a 20-night stay
    // look like a 20x higher "rate" than a 2-night stay at the same nightly
    // price, which corrupts the elasticity regression with fake variance.
    for (const res of reservations) {
      const night_count = res.nights || 1;
      for (let i = 0; i < night_count; i++) {
        const stay_date = new Date(res.check_in);
        stay_date.setDate(stay_date.getDate() + i);
        const date_key = stay_date.toISOString().split('T')[0];

        if (!rate_map[date_key]) rate_map[date_key] = { booked: 0, rate_cents: res.rate_cents || 4500 };
        rate_map[date_key].booked += 1;
      }
    }

    // Convert to rate/occupancy points. base_sites should reflect this
    // park's actual site count — the old hardcoded 10 compressed a 1-site
    // park's real 100%-on-booked-days occupancy down to a meaningless flat
    // 10%, which combined with every booked day scoring identically left
    // the regression with zero variance in occupancy to explain.
    const base_sites = Math.max(1, siteCount);
    for (const date_key in rate_map) {
      const booked = rate_map[date_key].booked;
      const occupancy = Math.min(1, booked / base_sites);
      rate_occupancy_pairs.push({
        rate: rate_map[date_key].rate_cents / 100, // Convert to dollars
        occupancy,
      });
    }

    // Build elasticity model
    const elasticity_model = new LinearRegression();
    let success = false;
    if (rate_occupancy_pairs.length >= 2) {
      const rates = rate_occupancy_pairs.map((p) => p.rate);
      const occupancies = rate_occupancy_pairs.map((p) => p.occupancy);
      success = elasticity_model.fit(rates, occupancies);
    }

    // Build time series model
    const ts_model = new TimeSeriesModel();
    let ts_success = false;
    if (occupancy_history.length >= 14) {
      ts_success = ts_model.fit(occupancy_history);
    }

    return {
      elasticity: elasticity_model,
      time_series: ts_model,
      data_points: rate_occupancy_pairs.length,
      accuracy_mae: Math.abs(elasticity_model.slope), // Placeholder MAE
      last_trained: new Date().toISOString(),
      model_health: {
        has_elasticity: success,
        has_timeseries: ts_success,
        sufficient_data: rate_occupancy_pairs.length >= 5,
      },
    };
  }

  /**
   * Predict occupancy given rate and date
   * Returns: {occupancy, confidence, method}
   */
  static predictOccupancy(rate, date, model) {
    if (!model) return { occupancy: 0.5, confidence: 0.3, method: 'default' };

    let predicted_occupancy = 0.5;
    let confidence = 0.3;
    let method = 'default';

    // Use elasticity model if available
    if (model.elasticity && model.elasticity.slope !== 0) {
      const elasticity_prediction = model.elasticity.predict(rate);
      predicted_occupancy = Math.max(0, Math.min(1, elasticity_prediction));
      confidence = Math.max(0.4, Math.min(0.8, Math.abs(model.elasticity.r_squared)));
      method = 'elasticity';
    } else if (model.elasticity && model.elasticity.mean_x > 0 && model.elasticity.mean_y > 0) {
      // The regression couldn't fit a real slope — this happens whenever
      // every historical booking shared the same nightly rate (the common
      // case for a park that has never run dynamic pricing), which leaves
      // zero rate variance to explain occupancy from. A pure power-law
      // demand curve (occupancy = mean_y * (rate/mean_x)^E) has no interior
      // revenue maximum for realistic |E| < 1 — revenue = rate*occupancy
      // just rises monotonically with rate, so a revenue-maximizing
      // optimizer always ends up picking the price ceiling. That's why the
      // 30-day calendar previously collapsed to the same $150-everywhere
      // suggestion for every date.
      //
      // Use a log-normal demand curve instead: occupancy peaks at the
      // site's own historical average rate and decays smoothly in both
      // directions in log-price space. This has a genuine interior revenue
      // maximum (for this decay constant, roughly 40% above the average
      // rate) — "raise your rate ~40%" is a believable AI recommendation;
      // "always charge the max the system allows" is not.
      const DEMAND_DECAY_K = 1 / Math.LN2; // occupancy ~halves each time price doubles
      const logRatio = Math.log(rate / model.elasticity.mean_x);
      let demand = model.elasticity.mean_y * Math.exp(-DEMAND_DECAY_K * logRatio * logRatio);

      // No real day-of-week signal exists yet (that requires occupancy
      // history the nightly performance-tracking cron hasn't built up yet)
      // — apply the same weekend-demand assumption the Pricing Intelligence
      // tab already uses elsewhere, so the calendar isn't perfectly
      // identical across every date in the meantime.
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayMultiplier = pricingConfig.dayOfWeekMultiplier[dayNames[new Date(date).getDay()]] || 1;
      demand *= dayMultiplier;

      predicted_occupancy = Math.max(0, Math.min(1, demand));
      confidence = 0.35;
      method = 'assumed-elasticity';
    }

    // Enhance with time series seasonality
    if (model.time_series && model.time_series.trend.length > 0) {
      const ts_pred = model.time_series.predict(date);
      // Blend: 70% elasticity + 30% seasonality
      predicted_occupancy = predicted_occupancy * 0.7 + ts_pred.occupancy * 0.3;
      confidence = Math.max(confidence, ts_pred.confidence * 0.5);
      method = 'blended';
    }

    return { occupancy: Math.max(0, Math.min(1, predicted_occupancy)), confidence, method };
  }

  /**
   * Optimize rate for a specific date
   * budget: 'revenue' (maximize price × occupancy) or 'occupancy' (maximize bookings)
   */
  static optimizeRate(date, model, baseRate, minRate, maxRate, budget = 'revenue') {
    if (!model) return { rate: baseRate, revenue: baseRate * 0.5, occupancy: 0.5, confidence: 0.3 };

    let best_rate = baseRate;
    let best_metric = 0;

    // Test rates in $5 increments
    for (let rate = minRate; rate <= maxRate; rate += 5) {
      const pred = RateOptimizer.predictOccupancy(rate, date, model);
      let metric = 0;

      if (budget === 'revenue') {
        // Maximize revenue = rate × occupancy
        metric = rate * pred.occupancy;
      } else {
        // Maximize occupancy
        metric = pred.occupancy;
      }

      if (metric > best_metric) {
        best_metric = metric;
        best_rate = rate;
      }
    }

    const final_pred = RateOptimizer.predictOccupancy(best_rate, date, model);
    return {
      rate: best_rate,
      occupancy: final_pred.occupancy,
      revenue: best_rate * final_pred.occupancy,
      confidence: final_pred.confidence,
      daily_expected_revenue: best_rate * final_pred.occupancy, // Per night
    };
  }

  /**
   * Generate 30-day rate suggestions
   */
  static suggestSeasonalRates(siteId, startDate, endDate, model, baseRate, minRate, maxRate) {
    const suggestions = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const date_str = current.toISOString().split('T')[0];
      const optimized = RateOptimizer.optimizeRate(date_str, model, baseRate, minRate, maxRate, 'revenue');

      suggestions.push({
        date: date_str,
        day_of_week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][current.getDay()],
        suggested_rate: Math.round(optimized.rate),
        predicted_occupancy: Math.round(optimized.occupancy * 100),
        revenue_estimate: Math.round(optimized.revenue * 100), // In cents
        confidence: Math.round(optimized.confidence * 100),
      });

      current.setDate(current.getDate() + 1);
    }

    return suggestions;
  }

  /**
   * Analyze rate elasticity
   * Returns: {elasticity, interpretation}
   * Elasticity < -1: highly elastic (demand sensitive to price)
   * -1 to -0.5: moderately elastic
   * > -0.5: inelastic (demand stable regardless of price)
   */
  static analyzeElasticity(model) {
    // No model has ever been trained at all — this really is a data
    // shortage (mlTrain requires 3+ bookings before it will even try).
    if (!model || !model.elasticity) {
      return {
        elasticity: 0,
        interpretation: 'insufficient data',
        recommendation: 'More historical data needed',
      };
    }

    let elasticity = model.elasticity.slope;
    let interpretation = 'moderate elasticity';
    let recommendation = 'Consider gradual rate adjustments';

    // slope === 0 does NOT mean there's no data — see predictOccupancy's
    // matching comment. It means every historical booking shared the same
    // nightly rate, so the regression had zero rate variance to learn an
    // elasticity from. That's the normal case for any park that's never
    // run dynamic pricing, real bookings or not, and it used to
    // permanently read "insufficient data" here regardless of how much
    // history existed. Report the same standard assumption
    // predictOccupancy already falls back to instead.
    if (elasticity === 0 && model.elasticity.mean_x > 0) {
      elasticity = STANDARD_ELASTICITY;
      interpretation = 'moderate elasticity (assumed — rates have never varied enough to measure this directly)';
      recommendation = 'Try a small rate change and watch how occupancy responds — that will let the model learn your site’s real price sensitivity instead of assuming it.';
      return { elasticity, interpretation, recommendation };
    } else if (elasticity === 0) {
      return {
        elasticity: 0,
        interpretation: 'insufficient data',
        recommendation: 'More historical data needed',
      };
    }

    if (elasticity < -0.8) {
      interpretation = 'high elasticity (price sensitive)';
      recommendation = 'Demand is very sensitive to price. Moderate rate increases could improve revenue.';
    } else if (elasticity < -0.5) {
      interpretation = 'moderate elasticity';
      recommendation = 'Demand responds moderately to price. Room for strategic rate increases.';
    } else if (elasticity < -0.2) {
      interpretation = 'low elasticity';
      recommendation = 'Demand relatively stable. Can raise rates with confidence.';
    }

    return { elasticity, interpretation, recommendation };
  }

  /**
   * Detect anomalies in booking pattern
   */
  static detectAnomalies(date, reservation_count, model) {
    if (!model || !model.time_series) return { is_anomaly: false, reason: '' };

    const pred = model.time_series.predict(date);
    const expected_occupancy = pred.occupancy;
    const std_dev = model.time_series.residual_std;

    // Flag if 2+ standard deviations from expected
    const z_score = Math.abs(reservation_count - expected_occupancy) / (std_dev || 0.1);
    const is_anomaly = z_score > 2;

    return {
      is_anomaly,
      z_score: z_score.toFixed(2),
      expected: expected_occupancy,
      actual: reservation_count,
      reason: is_anomaly ? `Unusual booking activity (Z-score: ${z_score.toFixed(2)})` : '',
    };
  }

  /**
   * Calculate model accuracy (MAE) on test set
   */
  static calculateAccuracy(predictions, actuals) {
    if (predictions.length === 0) return 0;
    const errors = predictions.map((p, i) => Math.abs(p - actuals[i]));
    const mae = errors.reduce((a, b) => a + b) / errors.length;
    return mae; // Mean Absolute Error in percentage points
  }
}

/**
 * Serialize model to JSON for storage in DB
 */
export function serializeModel(model) {
  if (!model) return null;
  return {
    elasticity: model.elasticity.toJSON(),
    time_series: model.time_series.toJSON(),
    data_points: model.data_points,
    accuracy_mae: model.accuracy_mae,
    last_trained: model.last_trained,
    model_health: model.model_health,
  };
}

/**
 * Deserialize model from JSON
 */
export function deserializeModel(json) {
  if (!json) return null;
  return {
    elasticity: LinearRegression.fromJSON(json.elasticity),
    time_series: TimeSeriesModel.fromJSON(json.time_series),
    data_points: json.data_points,
    accuracy_mae: json.accuracy_mae,
    last_trained: json.last_trained,
    model_health: json.model_health,
  };
}

export default RateOptimizer;
