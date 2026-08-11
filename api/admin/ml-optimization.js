/**
 * ML Optimization API Endpoints
 * Provides rate optimization, forecasting, and elasticity analysis
 *
 * GET /api/admin/ml-optimization/model-status?parkId=X&siteId=Y
 * GET /api/admin/ml-optimization/rate-prediction?siteId=Y&date=YYYY-MM-DD
 * GET /api/admin/ml-optimization/occupancy-forecast?siteId=Y&date=YYYY-MM-DD&rate=150
 * GET /api/admin/ml-optimization/elasticity?siteId=Y
 * GET /api/admin/ml-optimization/seasonal-rates?siteId=Y&month=9
 * GET /api/admin/ml-optimization/performance?siteId=Y&days=30
 * POST /api/admin/ml-optimization/train
 * POST /api/admin/ml-optimization/apply-suggestion
 */

import { authRequired } from '../_lib/auth.js';
import { Store } from '../_lib/reservations-store.js';
import RateOptimizer, { serializeModel, deserializeModel } from '../_lib/ml-rate-optimizer.js';

/**
 * Get model status and health
 */
async function handleModelStatus(req, res) {
  const { parkId, siteId } = req.query;

  if (!parkId || !siteId) {
    return res.status(400).json({ error: 'parkId and siteId required' });
  }

  try {
    // Fetch existing model
    const model_record = await Store.query(
      `SELECT model_json, accuracy_mae, last_trained, data_points_count
       FROM ml_models WHERE site_id = $1 AND park_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, parkId]
    );

    if (!model_record.rows.length) {
      return res.status(200).json({
        status: 'untrained',
        message: 'No model trained yet',
        data_points: 0,
        accuracy_mae: null,
        last_trained: null,
        next_step: 'Train model with historical data',
      });
    }

    const record = model_record.rows[0];
    const model = deserializeModel(JSON.parse(record.model_json));

    return res.status(200).json({
      status: model.model_health.sufficient_data ? 'ready' : 'training',
      message: model.model_health.sufficient_data ? 'Model ready' : 'Insufficient historical data',
      data_points: record.data_points_count,
      accuracy_mae: record.accuracy_mae ? parseFloat(record.accuracy_mae) : null,
      last_trained: record.last_trained,
      model_health: model.model_health,
      confidence: model.model_health.sufficient_data ? 0.8 : 0.3,
    });
  } catch (err) {
    console.error('Model status error:', err);
    return res.status(500).json({ error: 'Failed to fetch model status' });
  }
}

/**
 * Get predicted optimal rate for a specific date
 */
async function handleRatePrediction(req, res) {
  const { siteId, date } = req.query;

  if (!siteId || !date) {
    return res.status(400).json({ error: 'siteId and date required' });
  }

  try {
    // Get park and site info
    const site_result = await Store.query(
      `SELECT p.id as park_id, s.nightly_rate_cents, p.min_price_cents, p.max_price_cents
       FROM sites s JOIN parks p ON s.park_id = p.id
       WHERE s.id = $1`,
      [siteId]
    );

    if (!site_result.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const site = site_result.rows[0];
    const baseRate = site.nightly_rate_cents / 100;
    const minRate = (site.min_price_cents || 2000) / 100;
    const maxRate = (site.max_price_cents || 50000) / 100;

    // Fetch model
    const model_result = await Store.query(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, site.park_id]
    );

    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;

    // Optimize rate for date
    const optimization = RateOptimizer.optimizeRate(date, model, baseRate, minRate, maxRate, 'revenue');

    return res.status(200).json({
      date,
      suggested_rate: optimization.rate,
      current_rate: baseRate,
      rate_change_percent: ((optimization.rate - baseRate) / baseRate * 100).toFixed(1),
      predicted_occupancy: (optimization.occupancy * 100).toFixed(1),
      revenue_estimate: optimization.revenue.toFixed(2),
      confidence: (optimization.confidence * 100).toFixed(0),
      method: 'elastic-seasonal-blend',
    });
  } catch (err) {
    console.error('Rate prediction error:', err);
    return res.status(500).json({ error: 'Failed to predict rate' });
  }
}

/**
 * Get occupancy forecast for different rate points
 */
async function handleOccupancyForecast(req, res) {
  const { siteId, date, rate } = req.query;

  if (!siteId || !date) {
    return res.status(400).json({ error: 'siteId and date required' });
  }

  try {
    const site_result = await Store.query(
      `SELECT park_id FROM sites WHERE id = $1`,
      [siteId]
    );

    if (!site_result.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const park_id = site_result.rows[0].park_id;

    // Fetch model
    const model_result = await Store.query(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, park_id]
    );

    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;
    const test_rate = rate ? parseFloat(rate) : 150;

    const pred = RateOptimizer.predictOccupancy(test_rate, date, model);

    return res.status(200).json({
      date,
      rate: test_rate,
      predicted_occupancy_percent: (pred.occupancy * 100).toFixed(1),
      confidence_percent: (pred.confidence * 100).toFixed(0),
      prediction_method: pred.method,
      expected_revenue: (test_rate * pred.occupancy).toFixed(2),
    });
  } catch (err) {
    console.error('Occupancy forecast error:', err);
    return res.status(500).json({ error: 'Failed to forecast occupancy' });
  }
}

/**
 * Analyze price elasticity
 */
async function handleElasticity(req, res) {
  const { siteId } = req.query;

  if (!siteId) {
    return res.status(400).json({ error: 'siteId required' });
  }

  try {
    const site_result = await Store.query(`SELECT park_id FROM sites WHERE id = $1`, [siteId]);

    if (!site_result.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const park_id = site_result.rows[0].park_id;

    const model_result = await Store.query(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, park_id]
    );

    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;
    const analysis = RateOptimizer.analyzeElasticity(model);

    return res.status(200).json({
      elasticity_coefficient: analysis.elasticity.toFixed(2),
      interpretation: analysis.interpretation,
      recommendation: analysis.recommendation,
      explanation:
        'Elasticity measures price sensitivity: ' +
        'negative values mean demand decreases with price increases. ' +
        'Closer to -1 means more sensitive; closer to 0 means less sensitive.',
    });
  } catch (err) {
    console.error('Elasticity analysis error:', err);
    return res.status(500).json({ error: 'Failed to analyze elasticity' });
  }
}

/**
 * Generate seasonal rate suggestions for a month
 */
async function handleSeasonalRates(req, res) {
  const { siteId, month } = req.query;

  if (!siteId || !month) {
    return res.status(400).json({ error: 'siteId and month required' });
  }

  try {
    const site_result = await Store.query(
      `SELECT park_id, nightly_rate_cents FROM sites WHERE id = $1`,
      [siteId]
    );

    if (!site_result.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const { park_id, nightly_rate_cents } = site_result.rows[0];
    const baseRate = nightly_rate_cents / 100;

    const park_result = await Store.query(
      `SELECT min_price_cents, max_price_cents FROM parks WHERE id = $1`,
      [park_id]
    );

    const minRate = (park_result.rows[0]?.min_price_cents || 2000) / 100;
    const maxRate = (park_result.rows[0]?.max_price_cents || 50000) / 100;

    // Fetch model
    const model_result = await Store.query(
      `SELECT model_json FROM ml_models WHERE site_id = $1 AND park_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [siteId, park_id]
    );

    const model = model_result.rows.length ? deserializeModel(JSON.parse(model_result.rows[0].model_json)) : null;

    // Generate suggestions for the month
    const monthNum = parseInt(month);
    const year = new Date().getFullYear();
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split('T')[0];

    const suggestions = RateOptimizer.suggestSeasonalRates(siteId, startDate, endDate, model, baseRate, minRate, maxRate);

    // Summary statistics
    const rates = suggestions.map((s) => s.suggested_rate);
    const avg_rate = rates.reduce((a, b) => a + b) / rates.length;
    const occupancies = suggestions.map((s) => s.predicted_occupancy);
    const avg_occupancy = occupancies.reduce((a, b) => a + b) / occupancies.length;

    return res.status(200).json({
      month: monthNum,
      suggestions,
      summary: {
        average_suggested_rate: avg_rate.toFixed(2),
        average_predicted_occupancy: avg_occupancy.toFixed(1),
        current_base_rate: baseRate.toFixed(2),
        rate_range: [Math.min(...rates), Math.max(...rates)],
      },
    });
  } catch (err) {
    console.error('Seasonal rates error:', err);
    return res.status(500).json({ error: 'Failed to generate seasonal rates' });
  }
}

/**
 * Performance tracking: how accurate are recommendations?
 */
async function handlePerformance(req, res) {
  const { siteId, days = 30 } = req.query;

  if (!siteId) {
    return res.status(400).json({ error: 'siteId required' });
  }

  try {
    const site_result = await Store.query(`SELECT park_id FROM sites WHERE id = $1`, [siteId]);

    if (!site_result.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const park_id = site_result.rows[0].park_id;

    // Fetch rate performance records
    const performance = await Store.query(
      `SELECT
         date_of_stay,
         ai_suggested_rate,
         set_rate,
         actual_occupancy,
         actual_revenue_cents,
         accuracy_error
       FROM rate_performance
       WHERE site_id = $1 AND park_id = $2 AND date_of_stay >= NOW() - INTERVAL '${days} days'
       ORDER BY date_of_stay DESC`,
      [siteId, park_id]
    );

    if (!performance.rows.length) {
      return res.status(200).json({
        period_days: parseInt(days),
        accuracy_sample_size: 0,
        mean_accuracy_error: null,
        ai_recommendations_followed: 0,
        avg_revenue_per_night: 0,
        status: 'insufficient_data',
      });
    }

    const records = performance.rows;
    const errors = records.map((r) => Math.abs(r.accuracy_error || 0));
    const mean_error = errors.reduce((a, b) => a + b) / errors.length;
    const followed = records.filter((r) => r.set_rate === r.ai_suggested_rate).length;
    const revenues = records.map((r) => (r.actual_revenue_cents || 0) / 100);
    const avg_revenue = revenues.reduce((a, b) => a + b) / revenues.length;

    return res.status(200).json({
      period_days: parseInt(days),
      accuracy_sample_size: records.length,
      mean_accuracy_error_percent: mean_error.toFixed(1),
      median_accuracy_error: (errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)] || 0).toFixed(1),
      ai_recommendations_followed: followed,
      adoption_rate_percent: ((followed / records.length) * 100).toFixed(1),
      avg_revenue_per_night: avg_revenue.toFixed(2),
      status: mean_error < 10 ? 'accurate' : 'needs_improvement',
    });
  } catch (err) {
    console.error('Performance error:', err);
    return res.status(500).json({ error: 'Failed to fetch performance data' });
  }
}

/**
 * Manually trigger model training
 */
async function handleTrain(req, res) {
  const { parkId, siteId } = req.body;

  if (!parkId || !siteId) {
    return res.status(400).json({ error: 'parkId and siteId required' });
  }

  try {
    // Fetch historical reservations
    const reservations = await Store.query(
      `SELECT check_in, check_out, nights, subtotal_cents as rate_cents
       FROM reservations
       WHERE site_id = $1 AND park_id = $2 AND status IN ('confirmed', 'confirmed-deposit')
       AND check_in >= NOW() - INTERVAL '180 days'
       ORDER BY check_in`,
      [siteId, parkId]
    );

    // Fetch occupancy history
    const occupancy_data = await Store.query(
      `SELECT date_of_stay as date, (actual_occupancy)::NUMERIC as occupancy
       FROM rate_performance
       WHERE site_id = $1 AND park_id = $2
       ORDER BY date_of_stay DESC LIMIT 90`,
      [siteId, parkId]
    );

    const reserv_list = reservations.rows || [];
    const occ_list = (occupancy_data.rows || []).map((r) => ({ date: r.date, occupancy: parseFloat(r.occupancy) }));

    if (reserv_list.length < 3) {
      return res.status(400).json({ error: 'Insufficient historical data (need at least 3 bookings)' });
    }

    // Train model
    const model = RateOptimizer.trainModel(reserv_list, occ_list);

    // Store model
    const model_id = `mlm_${Date.now()}`;
    await Store.query(
      `INSERT INTO ml_models (id, site_id, park_id, model_version, model_json, accuracy_mae, last_trained, data_points_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        model_id,
        siteId,
        parkId,
        '1.0',
        JSON.stringify(serializeModel(model)),
        model.accuracy_mae,
        model.last_trained,
        model.data_points,
      ]
    );

    return res.status(200).json({
      status: 'success',
      model_id,
      data_points_used: model.data_points,
      accuracy_mae: model.accuracy_mae.toFixed(2),
      model_health: model.model_health,
      message: 'Model trained successfully',
    });
  } catch (err) {
    console.error('Training error:', err);
    return res.status(500).json({ error: 'Failed to train model' });
  }
}

/**
 * Apply AI suggestion and update rate
 */
async function handleApplySuggestion(req, res) {
  const { siteId, date, suggestedRate } = req.body;

  if (!siteId || !date || suggestedRate === undefined) {
    return res.status(400).json({ error: 'siteId, date, and suggestedRate required' });
  }

  try {
    const site_result = await Store.query(
      `SELECT park_id, nightly_rate_cents FROM sites WHERE id = $1`,
      [siteId]
    );

    if (!site_result.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const { park_id, nightly_rate_cents } = site_result.rows[0];
    const previous_rate = nightly_rate_cents;

    // Update seasonal rate or create new entry
    const applied_rate_cents = Math.round(suggestedRate * 100);

    const suggestion_id = `sugg_${Date.now()}`;
    await Store.query(
      `INSERT INTO rate_suggestions (id, site_id, park_id, date, suggested_rate, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [suggestion_id, siteId, park_id, date, suggestedRate, 0.8]
    );

    return res.status(200).json({
      status: 'success',
      suggestion_id,
      previous_rate: (previous_rate / 100).toFixed(2),
      applied_rate: suggestedRate.toFixed(2),
      change_percent: (((applied_rate_cents - previous_rate) / previous_rate) * 100).toFixed(1),
      message: 'Rate suggestion recorded',
    });
  } catch (err) {
    console.error('Apply suggestion error:', err);
    return res.status(500).json({ error: 'Failed to apply suggestion' });
  }
}

/**
 * Route handler
 */
export default async function handler(req, res) {
  // Authentication required
  const auth = authRequired(req, res);
  if (!auth) return;

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // GET endpoints
  if (req.method === 'GET') {
    if (pathname.endsWith('/model-status')) return handleModelStatus(req, res);
    if (pathname.endsWith('/rate-prediction')) return handleRatePrediction(req, res);
    if (pathname.endsWith('/occupancy-forecast')) return handleOccupancyForecast(req, res);
    if (pathname.endsWith('/elasticity')) return handleElasticity(req, res);
    if (pathname.endsWith('/seasonal-rates')) return handleSeasonalRates(req, res);
    if (pathname.endsWith('/performance')) return handlePerformance(req, res);
  }

  // POST endpoints
  if (req.method === 'POST') {
    if (pathname.endsWith('/train')) return handleTrain(req, res);
    if (pathname.endsWith('/apply-suggestion')) return handleApplySuggestion(req, res);
  }

  return res.status(404).json({ error: 'Not found' });
}
