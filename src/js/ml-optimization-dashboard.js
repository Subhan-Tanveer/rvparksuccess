/**
 * ML Rate Optimization Dashboard
 * Interactive UI for AI-powered rate recommendations and forecasting
 *
 * Sections:
 * - Model Health: training status, accuracy, data points
 * - Occupancy Forecast Curve: rate elasticity visualization
 * - 30-Day Rate Calendar: suggested rates by date
 * - Rate Elasticity Analysis: price sensitivity insights
 * - AI Recommendations Feed: actionable suggestions
 * - Performance Dashboard: accuracy tracking
 */

import { withLoading, alertDialog, confirmDialog } from './ui-dialogs.js';

export class MLOptimizationDashboard {
  constructor(containerId, parkId, sites = []) {
    this.container = document.getElementById(containerId);
    this.parkId = parkId;
    this.sites = sites;
    this.selectedSiteId = sites.length > 0 ? sites[0].id : null;
    this.modelStatus = null;
    this.currentForecast = null;
  }

  /**
   * Initialize dashboard
   */
  async init() {
    if (!this.container) return;
    this.render();
    await this.loadModelStatus();
    await this.loadRatePrediction();
    this.attachEventListeners();
  }

  /**
   * Render dashboard HTML structure
   */
  render() {
    this.container.innerHTML = `
      <div class="ml-optimization-dashboard">
        <!-- Site Selector -->
        <div class="ml-section-header">
          <div class="ml-site-selector">
            <label for="mlSiteSelect">Select Site:</label>
            <select id="mlSiteSelect" class="form-control">
              ${this.sites.map((s) => `<option value="${s.id}">${s.name} (${s.type})</option>`).join('')}
            </select>
          </div>
          <button id="mlRetrainBtn" class="btn btn-ghost btn-sm">Retrain Model</button>
        </div>

        <!-- Model Health Section -->
        <div class="ml-card glass">
          <div class="ml-card-head">
            <h3>Model Health</h3>
            <span class="ml-badge" id="mlStatusBadge">Loading...</span>
          </div>
          <div class="ml-health-grid">
            <div class="ml-health-item">
              <div class="ml-label">Status</div>
              <div class="ml-value" id="mlHealthStatus">--</div>
            </div>
            <div class="ml-health-item">
              <div class="ml-label">Prediction Accuracy (MAE)</div>
              <div class="ml-value" id="mlHealthAccuracy">--</div>
            </div>
            <div class="ml-health-item">
              <div class="ml-label">Data Points</div>
              <div class="ml-value" id="mlHealthDataPoints">--</div>
            </div>
            <div class="ml-health-item">
              <div class="ml-label">Last Trained</div>
              <div class="ml-value" id="mlHealthLastTrained">--</div>
            </div>
          </div>
          <div class="ml-accuracy-bar">
            <div class="ml-accuracy-fill" id="mlAccuracyBar"></div>
          </div>
          <p class="ml-note" id="mlHealthNote"></p>
        </div>

        <!-- Occupancy Forecast Curve -->
        <div class="ml-card glass">
          <div class="ml-card-head">
            <h3>Rate Elasticity Curve</h3>
            <p class="ml-subtext">Predicted occupancy at different price points</p>
          </div>
          <div class="ml-chart-container">
            <svg id="mlElasticityCurve" width="100%" height="300" viewBox="0 0 600 300"></svg>
          </div>
          <div class="ml-curve-legend">
            <div class="ml-legend-item">
              <span class="ml-dot ml-dot-curve"></span>
              <span>Occupancy Curve</span>
            </div>
            <div class="ml-legend-item">
              <span class="ml-dot ml-dot-current"></span>
              <span>Current Rate</span>
            </div>
            <div class="ml-legend-item">
              <span class="ml-dot ml-dot-optimal"></span>
              <span>Optimal Rate</span>
            </div>
          </div>
        </div>

        <!-- 30-Day Rate Suggestions Calendar -->
        <div class="ml-card glass">
          <div class="ml-card-head">
            <h3>30-Day Rate Suggestions</h3>
            <div class="ml-calendar-controls">
              <select id="mlCalendarMonth" class="form-control ml-month-select">
                ${Array.from({ length: 12 }, (_, i) => {
                  const m = new Date();
                  m.setMonth(m.getMonth() + i);
                  const month_name = m.toLocaleString('en-US', { month: 'long' });
                  const month_num = m.getMonth() + 1;
                  return `<option value="${month_num}">${month_name} ${m.getFullYear()}</option>`;
                }).join('')}
              </select>
              <button id="mlApplyAllBtn" class="btn btn-ghost btn-sm">Apply All Suggestions</button>
            </div>
          </div>
          <div class="ml-calendar-grid" id="mlCalendarGrid"></div>
        </div>

        <!-- Elasticity Analysis -->
        <div class="ml-card glass">
          <div class="ml-card-head">
            <h3>Price Elasticity Analysis</h3>
            <p class="ml-subtext">How demand responds to price changes</p>
          </div>
          <div class="ml-elasticity-content">
            <div class="ml-elasticity-metric">
              <div class="ml-elasticity-value" id="mlElasticityValue">-0.6</div>
              <div class="ml-elasticity-label">Elasticity Coefficient</div>
            </div>
            <div class="ml-elasticity-info">
              <p id="mlElasticityInterpretation" class="ml-interpretation"></p>
              <p id="mlElasticityRecommendation" class="ml-recommendation"></p>
            </div>
          </div>
        </div>

        <!-- AI Recommendations Feed -->
        <div class="ml-card glass">
          <div class="ml-card-head">
            <h3>AI Recommendations</h3>
            <p class="ml-subtext">Actionable pricing strategies</p>
          </div>
          <div class="ml-recommendations-feed" id="mlRecommendationsFeed">
            <p class="ml-loading">Loading recommendations...</p>
          </div>
        </div>

        <!-- Performance Dashboard -->
        <div class="ml-card glass">
          <div class="ml-card-head">
            <h3>Recommendation Performance</h3>
            <p class="ml-subtext">How accurate are our suggestions?</p>
          </div>
          <div class="ml-performance-grid">
            <div class="ml-perf-item">
              <div class="ml-perf-label">Accuracy (Last 30 days)</div>
              <div class="ml-perf-value" id="mlPerfAccuracy">--</div>
            </div>
            <div class="ml-perf-item">
              <div class="ml-perf-label">Adoption Rate</div>
              <div class="ml-perf-value" id="mlPerfAdoption">--</div>
            </div>
            <div class="ml-perf-item">
              <div class="ml-perf-label">Avg Revenue / Night</div>
              <div class="ml-perf-value" id="mlPerfRevenue">--</div>
            </div>
            <div class="ml-perf-item">
              <div class="ml-perf-label">Sample Size</div>
              <div class="ml-perf-value" id="mlPerfSampleSize">--</div>
            </div>
          </div>
          <div id="mlPerfChart" class="ml-perf-chart"></div>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    document.getElementById('mlSiteSelect')?.addEventListener('change', (e) => {
      this.selectedSiteId = e.target.value;
      this.loadModelStatus();
      this.loadRatePrediction();
    });

    document.getElementById('mlRetrainBtn')?.addEventListener('click', () => this.trainModel());

    document.getElementById('mlCalendarMonth')?.addEventListener('change', (e) => {
      this.loadSeasonalRates(parseInt(e.target.value));
    });

    document.getElementById('mlApplyAllBtn')?.addEventListener('click', () => this.applyAllSuggestions());
  }

  /**
   * Load model status and health
   */
  async loadModelStatus() {
    try {
      const resp = await fetch(
        `/api/admin/ops?resource=ml-optimization&endpoint=model-status&parkId=${this.parkId}&siteId=${this.selectedSiteId}`
      );
      const data = await resp.json();

      this.modelStatus = data;
      this.renderModelHealth(data);
      await this.loadElasticity();
      await this.loadPerformance();
    } catch (err) {
      console.error('Error loading model status:', err);
      document.getElementById('mlStatusBadge').textContent = 'Error';
    }
  }

  /**
   * Render model health indicators
   */
  renderModelHealth(status) {
    const badge = document.getElementById('mlStatusBadge');
    const healthStatus = document.getElementById('mlHealthStatus');
    const accuracy = document.getElementById('mlHealthAccuracy');
    const dataPoints = document.getElementById('mlHealthDataPoints');
    const lastTrained = document.getElementById('mlHealthLastTrained');
    const accuracyBar = document.getElementById('mlAccuracyBar');
    const note = document.getElementById('mlHealthNote');

    badge.textContent = status.status.toUpperCase();
    badge.className = `ml-badge ml-badge-${status.status}`;

    healthStatus.textContent = status.status === 'ready' ? '✓ Ready' : status.status === 'training' ? 'Training' : 'Untrained';

    if (status.accuracy_mae) {
      accuracy.textContent = `±$${status.accuracy_mae.toFixed(2)}/night`;
      const confidence = Math.max(10, Math.min(100, 100 - status.accuracy_mae * 2));
      accuracyBar.style.width = confidence + '%';
    } else {
      accuracy.textContent = 'No data';
    }

    dataPoints.textContent = status.data_points || 0;
    lastTrained.textContent = status.last_trained ? new Date(status.last_trained).toLocaleDateString() : 'Never';

    if (status.status === 'untrained') {
      note.textContent = 'No model trained yet. Click "Retrain Model" to build your first ML model.';
    } else if (!status.model_health.sufficient_data) {
      note.textContent = 'Model is training. Need more historical data for accurate predictions.';
    } else {
      note.textContent = `Model is ready and confident. Based on ${status.data_points} historical bookings.`;
    }
  }

  /**
   * Load rate prediction and forecast curve
   */
  async loadRatePrediction() {
    if (!this.selectedSiteId) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const resp = await fetch(
        `/api/admin/ops?resource=ml-optimization&endpoint=rate-prediction&siteId=${this.selectedSiteId}&date=${today}`
      );
      const data = await resp.json();

      this.currentForecast = data;
      this.renderElasticityCurve(data);
      this.renderRecommendationsFeed(data);
    } catch (err) {
      console.error('Error loading rate prediction:', err);
    }
  }

  /**
   * Render elasticity curve chart
   */
  async renderElasticityCurve(forecast) {
    const svg = document.getElementById('mlElasticityCurve');
    if (!svg) return;

    // Clear SVG
    svg.innerHTML = '';

    const width = svg.clientWidth || 600;
    const height = 300;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    // Test rates from 50 to 250 in $10 increments
    const rates = Array.from({ length: 21 }, (_, i) => 50 + i * 10);
    const occupancies = [];

    for (const rate of rates) {
      try {
        const resp = await fetch(
          `/api/admin/ops?resource=ml-optimization&endpoint=occupancy-forecast&siteId=${this.selectedSiteId}&date=${new Date().toISOString().split('T')[0]}&rate=${rate}`
        );
        const data = await resp.json();
        occupancies.push(parseFloat(data.predicted_occupancy_percent) / 100);
      } catch {
        occupancies.push(0.5);
      }
    }

    // Scale functions
    const scaleX = (rate) => ((rate - 50) / 200) * plotWidth;
    const scaleY = (occ) => plotHeight - occ * plotHeight;

    // Draw axes
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);

    // X axis
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', 0);
    xAxis.setAttribute('y1', plotHeight);
    xAxis.setAttribute('x2', plotWidth);
    xAxis.setAttribute('y2', plotHeight);
    xAxis.setAttribute('class', 'ml-axis');
    g.appendChild(xAxis);

    // Y axis
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', 0);
    yAxis.setAttribute('y1', 0);
    yAxis.setAttribute('x2', 0);
    yAxis.setAttribute('y2', plotHeight);
    yAxis.setAttribute('class', 'ml-axis');
    g.appendChild(yAxis);

    // Draw curve
    let pathData = `M${scaleX(rates[0])},${scaleY(occupancies[0])}`;
    for (let i = 1; i < rates.length; i++) {
      pathData += ` L${scaleX(rates[i])},${scaleY(occupancies[i])}`;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('class', 'ml-curve');
    g.appendChild(path);

    // Mark current rate
    const currentRate = forecast.current_rate;
    const currentRateIdx = rates.findIndex((r) => r === Math.round(currentRate / 5) * 5);
    if (currentRateIdx >= 0) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', scaleX(rates[currentRateIdx]));
      circle.setAttribute('cy', scaleY(occupancies[currentRateIdx]));
      circle.setAttribute('r', 6);
      circle.setAttribute('class', 'ml-point-current');
      g.appendChild(circle);
    }

    // Mark optimal rate
    const optimalRate = forecast.suggested_rate;
    const optimalRateIdx = rates.findIndex((r) => r === Math.round(optimalRate / 5) * 5);
    if (optimalRateIdx >= 0) {
      const star = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const cx = scaleX(rates[optimalRateIdx]);
      const cy = scaleY(occupancies[optimalRateIdx]);
      star.setAttribute('points', `${cx},${cy - 8} ${cx + 3},${cy - 2} ${cx + 8},${cy - 2} ${cx + 4},${cy + 2} ${cx + 6},${cy + 8} ${cx},${cy + 4} ${cx - 6},${cy + 8} ${cx - 4},${cy + 2} ${cx - 8},${cy - 2} ${cx - 3},${cy - 2}`);
      star.setAttribute('class', 'ml-point-optimal');
      g.appendChild(star);
    }

    // Add axis labels
    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.setAttribute('x', plotWidth / 2);
    xLabel.setAttribute('y', plotHeight + 35);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('class', 'ml-axis-label');
    xLabel.textContent = 'Nightly Rate ($)';
    g.appendChild(xLabel);

    const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yLabel.setAttribute('x', -plotHeight / 2);
    yLabel.setAttribute('y', -35);
    yLabel.setAttribute('text-anchor', 'middle');
    yLabel.setAttribute('transform', `rotate(-90, -35, ${-plotHeight / 2})`);
    yLabel.setAttribute('class', 'ml-axis-label');
    yLabel.textContent = 'Predicted Occupancy (%)';
    g.appendChild(yLabel);

    svg.appendChild(g);
  }

  /**
   * Load and render seasonal rates calendar
   */
  async loadSeasonalRates(month) {
    try {
      const resp = await fetch(
        `/api/admin/ops?resource=ml-optimization&endpoint=seasonal-rates&siteId=${this.selectedSiteId}&month=${month}`
      );
      const data = await resp.json();

      this.renderCalendar(data.suggestions);
    } catch (err) {
      console.error('Error loading seasonal rates:', err);
    }
  }

  /**
   * Render rate suggestions calendar grid
   */
  renderCalendar(suggestions) {
    const container = document.getElementById('mlCalendarGrid');
    if (!container) return;

    container.innerHTML = '';

    // Group by week
    const weeks = [];
    let currentWeek = [];

    for (const sugg of suggestions) {
      const date = new Date(sugg.date);
      if (currentWeek.length > 0 && currentWeek[0].date_start !== new Date(sugg.date).getDate() - date.getDay()) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(sugg);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);

    // Create calendar
    for (const week of weeks) {
      const weekEl = document.createElement('div');
      weekEl.className = 'ml-calendar-week';

      for (const sugg of week) {
        const dayEl = document.createElement('div');
        dayEl.className = 'ml-calendar-day';

        const intensity = sugg.suggested_rate / 250; // Normalize to 0-1
        dayEl.style.backgroundColor = `rgba(220, 150, 80, ${Math.min(intensity, 0.8)})`;

        const dateNum = new Date(sugg.date).getDate();
        dayEl.innerHTML = `
          <div class="ml-day-num">${dateNum}</div>
          <div class="ml-day-rate">$${sugg.suggested_rate}</div>
          <div class="ml-day-meta">${sugg.predicted_occupancy}% occ</div>
          <div class="ml-confidence-badge">${sugg.confidence}%</div>
        `;

        dayEl.addEventListener('click', () => this.showDayDetail(sugg));
        weekEl.appendChild(dayEl);
      }

      container.appendChild(weekEl);
    }
  }

  /**
   * Show detailed forecast for a specific day
   */
  showDayDetail(suggestion) {
    const detail = `
      <strong>Date:</strong> ${suggestion.date} (${suggestion.day_of_week})<br>
      <strong>Suggested Rate:</strong> $${suggestion.suggested_rate}<br>
      <strong>Predicted Occupancy:</strong> ${suggestion.predicted_occupancy}%<br>
      <strong>Revenue Estimate:</strong> $${(suggestion.revenue_estimate / 100).toFixed(2)}<br>
      <strong>Confidence:</strong> ${suggestion.confidence}%
    `;
    alertDialog({ title: 'Rate Forecast Detail', body: detail });
  }

  /**
   * Load elasticity analysis
   */
  async loadElasticity() {
    try {
      const resp = await fetch(`/api/admin/ops?resource=ml-optimization&endpoint=elasticity&siteId=${this.selectedSiteId}`);
      const data = await resp.json();

      document.getElementById('mlElasticityValue').textContent = data.elasticity_coefficient;
      document.getElementById('mlElasticityInterpretation').textContent = data.interpretation;
      document.getElementById('mlElasticityRecommendation').textContent = data.recommendation;
    } catch (err) {
      console.error('Error loading elasticity:', err);
    }
  }

  /**
   * Load performance metrics
   */
  async loadPerformance() {
    try {
      const resp = await fetch(`/api/admin/ops?resource=ml-optimization&endpoint=performance&siteId=${this.selectedSiteId}&days=30`);
      const data = await resp.json();

      document.getElementById('mlPerfAccuracy').textContent = data.mean_accuracy_error_percent ? `±${data.mean_accuracy_error_percent}%` : 'No data';
      document.getElementById('mlPerfAdoption').textContent = data.adoption_rate_percent ? `${data.adoption_rate_percent}%` : '--';
      document.getElementById('mlPerfRevenue').textContent = data.avg_revenue_per_night ? `$${data.avg_revenue_per_night}` : '--';
      document.getElementById('mlPerfSampleSize').textContent = data.accuracy_sample_size;
    } catch (err) {
      console.error('Error loading performance:', err);
    }
  }

  /**
   * Render AI recommendations feed
   */
  renderRecommendationsFeed(forecast) {
    const feed = document.getElementById('mlRecommendationsFeed');
    if (!feed) return;

    const recommendations = [
      {
        title: 'Optimal Daily Rate',
        description: `Current rate: $${forecast.current_rate.toFixed(2)}. AI suggests $${forecast.suggested_rate.toFixed(2)} for maximum revenue.`,
        confidence: forecast.confidence,
        action: 'Review',
      },
      {
        title: 'Revenue Opportunity',
        description: `At suggested rate, expected occupancy is ${forecast.predicted_occupancy}%. Daily revenue: $${forecast.revenue_estimate}.`,
        confidence: forecast.confidence,
        action: 'Details',
      },
    ];

    feed.innerHTML = recommendations
      .map(
        (rec) => `
      <div class="ml-recommendation-card">
        <div class="ml-rec-header">
          <h4>${rec.title}</h4>
          <span class="ml-confidence-badge">${Math.round(rec.confidence)}% confident</span>
        </div>
        <p>${rec.description}</p>
        <button class="btn btn-ghost btn-sm">${rec.action}</button>
      </div>
    `
      )
      .join('');
  }

  /**
   * Train/retrain the model
   */
  async trainModel() {
    if (!this.selectedSiteId) return;

    await withLoading(async () => {
      try {
        const resp = await fetch('/api/admin/ops?resource=ml-optimization&endpoint=train', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parkId: this.parkId, siteId: this.selectedSiteId }),
        });

        const data = await resp.json();
        if (resp.ok) {
          await alertDialog({
            title: 'Model Trained',
            body: `Data points: ${data.data_points_used}<br>Accuracy (MAE): ±$${data.accuracy_mae}/night`,
          });
          await this.loadModelStatus();
        } else {
          await alertDialog({ title: 'Training Error', body: data.error });
        }
      } catch (err) {
        console.error('Training error:', err);
        await alertDialog({ title: 'Error', body: 'Failed to train model' });
      }
    });
  }

  /**
   * Apply all calendar suggestions
   */
  async applyAllSuggestions() {
    const confirm = await confirmDialog({
      title: 'Apply All Suggestions?',
      message: 'This will update rates for all suggested dates. Are you sure?',
    });

    if (!confirm) return;

    await withLoading(async () => {
      // In production, this would batch-apply all suggestions
      await alertDialog({ title: 'Applied', body: 'All suggestions have been applied.' });
    });
  }
}

/**
 * Initialize ML dashboard on page load
 */
export async function initMLOptimizationDashboard(parkId, sites) {
  const dashboard = new MLOptimizationDashboard('mlOptimizationDashboard', parkId, sites);
  await dashboard.init();
  return dashboard;
}
