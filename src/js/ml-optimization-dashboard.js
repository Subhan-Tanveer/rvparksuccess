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
import { renderAiInsightWidget } from './ai-insight-widget.js';

export class MLOptimizationDashboard {
  constructor(containerId, parkId, sites = []) {
    this.container = document.getElementById(containerId);
    this.parkId = parkId;
    this.sites = sites;
    this.selectedSiteId = sites.length > 0 ? sites[0].id : null;
    this.modelStatus = null;
    this.currentForecast = null;
    this.currentSuggestions = [];
  }

  /**
   * Re-render the elasticity curve — needed because the ML Optimization
   * section lives behind the dashboard's sidebar tabs and starts
   * display:none if it isn't the initially active tab. svg.clientWidth
   * reads 0 while hidden, so the chart's very first render locks in a
   * 600-unit fallback layout; without a redraw once the tab actually
   * becomes visible, that stale layout never corrects itself (same
   * 0-width-while-hidden issue the Advanced Analytics tab already works
   * around with its own redrawCharts()).
   */
  redrawCharts() {
    if (this.currentForecast) this.renderElasticityCurve(this.currentForecast);
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
          <div id="mlAiInsightSlot"></div>
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
      this.renderAiInsight();
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

    svg.innerHTML = '';

    const width = svg.clientWidth || 600;
    const height = 300;
    // The HTML template hardcodes viewBox="0 0 600 300", but `width` above
    // is the SVG's real on-screen pixel width (often ~1150+ in the actual
    // dashboard layout, not 600). Every cx/cy computed below assumes a
    // coordinate space matching `width`, so leaving the viewBox pinned at
    // 600 made the browser uniformly scale the whole SVG drawing to fit —
    // while the plain HTML tooltip div (positioned with ordinary, unscaled
    // CSS pixels) kept using the un-scaled cx/cy values. The dot rendered
    // in the right place; the tooltip did not. Syncing the viewBox to the
    // real width/height keeps 1 SVG unit == 1 real pixel, so both agree.
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const margin = { top: 20, right: 24, bottom: 44, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const currentRate = forecast.current_rate || 50;
    const optimalRate = forecast.suggested_rate || currentRate;

    // Test a range that always brackets both the current and optimal rate
    // (with headroom) instead of a fixed $50-$250 window — the site's real
    // rate can sit anywhere, and a fixed window meant the current/optimal
    // markers frequently fell outside the tested range and just never
    // rendered.
    const rangeLow = Math.max(10, Math.floor(Math.min(currentRate, optimalRate) * 0.6 / 5) * 5);
    const rangeHigh = Math.ceil(Math.max(currentRate, optimalRate) * 1.8 / 5) * 5;
    const steps = 20;
    const stepSize = (rangeHigh - rangeLow) / steps;
    const rates = Array.from({ length: steps + 1 }, (_, i) => Math.round(rangeLow + i * stepSize));

    const date = new Date().toISOString().split('T')[0];
    const occupancies = await Promise.all(
      rates.map((rate) =>
        fetch(`/api/admin/ops?resource=ml-optimization&endpoint=occupancy-forecast&siteId=${this.selectedSiteId}&date=${date}&rate=${rate}`)
          .then((r) => r.json())
          .then((data) => parseFloat(data.predicted_occupancy_percent) / 100)
          .catch(() => 0.5)
      )
    );

    const scaleX = (rate) => ((rate - rangeLow) / (rangeHigh - rangeLow)) * plotWidth;
    const scaleY = (occ) => plotHeight - occ * plotHeight;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);
    const svgNS = 'http://www.w3.org/2000/svg';
    const el = (tag) => document.createElementNS(svgNS, tag);

    // Horizontal gridlines + y-axis occupancy labels (0/25/50/75/100%)
    for (let i = 0; i <= 4; i++) {
      const occVal = i / 4;
      const y = scaleY(occVal);
      const gridLine = el('line');
      gridLine.setAttribute('x1', 0);
      gridLine.setAttribute('y1', y);
      gridLine.setAttribute('x2', plotWidth);
      gridLine.setAttribute('y2', y);
      gridLine.setAttribute('class', 'ml-grid-line');
      g.appendChild(gridLine);

      const tick = el('text');
      tick.setAttribute('x', -8);
      tick.setAttribute('y', y);
      tick.setAttribute('text-anchor', 'end');
      tick.setAttribute('dominant-baseline', 'middle');
      tick.setAttribute('class', 'ml-tick-label');
      tick.textContent = `${Math.round(occVal * 100)}%`;
      g.appendChild(tick);
    }

    // Vertical gridlines + x-axis dollar labels at 5 evenly-spaced rates
    for (let i = 0; i <= 4; i++) {
      const rate = rangeLow + ((rangeHigh - rangeLow) * i) / 4;
      const x = scaleX(rate);
      const gridLine = el('line');
      gridLine.setAttribute('x1', x);
      gridLine.setAttribute('y1', 0);
      gridLine.setAttribute('x2', x);
      gridLine.setAttribute('y2', plotHeight);
      gridLine.setAttribute('class', 'ml-grid-line');
      g.appendChild(gridLine);

      const tick = el('text');
      tick.setAttribute('x', x);
      tick.setAttribute('y', plotHeight + 16);
      tick.setAttribute('text-anchor', 'middle');
      tick.setAttribute('class', 'ml-tick-label');
      tick.textContent = `$${Math.round(rate)}`;
      g.appendChild(tick);
    }

    // Axes
    const xAxis = el('line');
    xAxis.setAttribute('x1', 0);
    xAxis.setAttribute('y1', plotHeight);
    xAxis.setAttribute('x2', plotWidth);
    xAxis.setAttribute('y2', plotHeight);
    xAxis.setAttribute('class', 'ml-axis');
    g.appendChild(xAxis);

    const yAxis = el('line');
    yAxis.setAttribute('x1', 0);
    yAxis.setAttribute('y1', 0);
    yAxis.setAttribute('x2', 0);
    yAxis.setAttribute('y2', plotHeight);
    yAxis.setAttribute('class', 'ml-axis');
    g.appendChild(yAxis);

    // Curve
    let pathData = `M${scaleX(rates[0])},${scaleY(occupancies[0])}`;
    for (let i = 1; i < rates.length; i++) {
      pathData += ` L${scaleX(rates[i])},${scaleY(occupancies[i])}`;
    }
    const path = el('path');
    path.setAttribute('d', pathData);
    path.setAttribute('class', 'ml-curve');
    g.appendChild(path);

    // Dots along the curve — same interaction pattern as the Revenue Trend
    // chart. Each dot is drawn small (r=3) for a clean line, but sits under
    // an invisible larger circle that actually receives the pointer events
    // — a 3px target is hard to land a click on precisely, especially on
    // touch. Both hover AND click/tap open the tooltip (click also makes it
    // stick open, since a tap has no "hover" state to keep it visible).
    // Appended to <body> with position: fixed rather than inside the chart
    // card — any ancestor's overflow:hidden (the chart container has one,
    // to stop the chart itself spawning a scrollbar) or z-index/stacking
    // context would otherwise clip or bury the tooltip. A fixed-position
    // element escapes all of that, so it's always fully visible regardless
    // of what container styling changes around it later.
    let tooltip = document._mlChartTooltipEl;
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'ml-chart-tooltip';
      document.body.appendChild(tooltip);
      document._mlChartTooltipEl = tooltip;
    }
    rates.forEach((rate, i) => {
      const cx = scaleX(rate);
      const cy = scaleY(occupancies[i]);

      const showTooltip = () => {
        tooltip.textContent = `$${rate}/night → ${Math.round(occupancies[i] * 100)}% occupancy`;
        // Convert the point's SVG-space coordinates to real screen pixels
        // via the browser's own CTM rather than adding raw offsets — the
        // viewBox is kept in sync with the SVG's pixel width at render
        // time, but this section can still be display:none at that exact
        // moment (it's one of several sidebar tabs) which would freeze a
        // stale/mismatched viewBox until the next redraw. getScreenCTM()
        // accounts for whatever scale the browser is actually applying
        // right now, so the tooltip lines up with the dot even if a
        // redraw hasn't caught up yet.
        const svgPoint = svg.createSVGPoint();
        svgPoint.x = margin.left + cx;
        svgPoint.y = margin.top + cy;
        const screenPoint = svgPoint.matrixTransform(svg.getScreenCTM());
        tooltip.style.left = `${screenPoint.x}px`;
        tooltip.style.top = `${screenPoint.y}px`;
        // Flip downward instead of upward whenever there isn't roughly a
        // tooltip's-height of room above the point on screen.
        tooltip.classList.toggle('is-below', screenPoint.y < 44);
        tooltip.style.display = 'block';
      };

      const dot = el('circle');
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      dot.setAttribute('r', 3);
      dot.setAttribute('class', 'ml-curve-dot');

      const hitArea = el('circle');
      hitArea.setAttribute('cx', cx);
      hitArea.setAttribute('cy', cy);
      hitArea.setAttribute('r', 10);
      hitArea.setAttribute('fill', 'transparent');
      hitArea.style.cursor = 'pointer';
      hitArea.addEventListener('mouseenter', showTooltip);
      hitArea.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
      hitArea.addEventListener('click', (e) => {
        e.stopPropagation();
        showTooltip();
      });

      g.appendChild(dot);
      g.appendChild(hitArea);
    });

    // Tapping/clicking outside any dot dismisses a click-opened tooltip.
    svg.addEventListener('click', () => {
      tooltip.style.display = 'none';
    });

    // Mark current rate — nearest tested point, not an exact-match lookup
    // (the old code required an exact 5-multiple match against a fixed
    // $50-$250/10 grid, so a real rate like $45 or an optimal rate like $65
    // silently matched nothing and no marker ever appeared).
    let currentIdx = 0;
    let optimalIdx = 0;
    rates.forEach((r, i) => {
      if (Math.abs(r - currentRate) < Math.abs(rates[currentIdx] - currentRate)) currentIdx = i;
      if (Math.abs(r - optimalRate) < Math.abs(rates[optimalIdx] - optimalRate)) optimalIdx = i;
    });

    const circle = el('circle');
    circle.setAttribute('cx', scaleX(rates[currentIdx]));
    circle.setAttribute('cy', scaleY(occupancies[currentIdx]));
    circle.setAttribute('r', 6);
    circle.setAttribute('class', 'ml-point-current');
    g.appendChild(circle);
    const currentLabel = el('text');
    currentLabel.setAttribute('x', scaleX(rates[currentIdx]));
    currentLabel.setAttribute('y', scaleY(occupancies[currentIdx]) - 12);
    currentLabel.setAttribute('text-anchor', 'middle');
    currentLabel.setAttribute('class', 'ml-point-label ml-point-label-current');
    currentLabel.textContent = `Current $${Math.round(currentRate)}`;
    g.appendChild(currentLabel);

    if (optimalIdx !== currentIdx) {
      const cx = scaleX(rates[optimalIdx]);
      const cy = scaleY(occupancies[optimalIdx]);
      const star = el('polygon');
      star.setAttribute('points', `${cx},${cy - 8} ${cx + 3},${cy - 2} ${cx + 8},${cy - 2} ${cx + 4},${cy + 2} ${cx + 6},${cy + 8} ${cx},${cy + 4} ${cx - 6},${cy + 8} ${cx - 4},${cy + 2} ${cx - 8},${cy - 2} ${cx - 3},${cy - 2}`);
      star.setAttribute('class', 'ml-point-optimal');
      g.appendChild(star);
      const optimalLabel = el('text');
      optimalLabel.setAttribute('x', cx);
      optimalLabel.setAttribute('y', cy - 14);
      optimalLabel.setAttribute('text-anchor', 'middle');
      optimalLabel.setAttribute('class', 'ml-point-label ml-point-label-optimal');
      optimalLabel.textContent = `Optimal $${Math.round(optimalRate)}`;
      g.appendChild(optimalLabel);
    }

    // Axis titles
    const xLabel = el('text');
    xLabel.setAttribute('x', plotWidth / 2);
    xLabel.setAttribute('y', plotHeight + 36);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('class', 'ml-axis-label');
    xLabel.textContent = 'Nightly Rate ($)';
    g.appendChild(xLabel);

    const yLabel = el('text');
    yLabel.setAttribute('x', -plotHeight / 2);
    yLabel.setAttribute('y', -40);
    yLabel.setAttribute('text-anchor', 'middle');
    yLabel.setAttribute('transform', `rotate(-90, -40, ${-plotHeight / 2})`);
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

      this.currentSuggestions = data.suggestions || [];
      this.renderCalendar(this.currentSuggestions);
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
    if (!suggestions.length) return;

    // Weekday header row (Sun-Sat) so the grid reads as an actual calendar.
    const headerEl = document.createElement('div');
    headerEl.className = 'ml-calendar-week ml-calendar-header';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'ml-calendar-day-label';
      cell.textContent = label;
      headerEl.appendChild(cell);
    });
    container.appendChild(headerEl);

    // Split into Sun-Sat weeks, padding the first/last week with blank
    // cells so each day lands in its correct weekday column. The previous
    // version grouped strictly by array position with a broken "same week"
    // check (it read a `date_start` field that was never set), so every
    // suggestion ended up alone in its own "week" — rendering as a single
    // narrow column instead of a 7-day calendar grid.
    const weeks = [];
    let currentWeek = [];

    const firstDow = new Date(suggestions[0].date).getDay();
    for (let i = 0; i < firstDow; i++) currentWeek.push(null);

    for (const sugg of suggestions) {
      currentWeek.push(sugg);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
    }

    // Create calendar
    for (const week of weeks) {
      const weekEl = document.createElement('div');
      weekEl.className = 'ml-calendar-week';

      for (const sugg of week) {
        const dayEl = document.createElement('div');

        if (!sugg) {
          dayEl.className = 'ml-calendar-day ml-calendar-day-empty';
          weekEl.appendChild(dayEl);
          continue;
        }

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
   * Show detailed forecast for a specific day, with the option to apply
   * just that one date's suggested rate — previously the only way to apply
   * anything was "Apply All Suggestions" for the whole month; clicking an
   * individual day only ever opened a read-only detail popup with no
   * action available on it at all.
   */
  async showDayDetail(suggestion) {
    const detail = `
      <strong>Date:</strong> ${suggestion.date} (${suggestion.day_of_week})<br>
      <strong>Suggested Rate:</strong> $${suggestion.suggested_rate}<br>
      <strong>Predicted Occupancy:</strong> ${suggestion.predicted_occupancy}%<br>
      <strong>Revenue Estimate:</strong> $${(suggestion.revenue_estimate / 100).toFixed(2)}<br>
      <strong>Confidence:</strong> ${suggestion.confidence}%
    `;

    const wantsApply = await confirmDialog({
      title: 'Rate Forecast Detail',
      message: detail,
      confirmLabel: `Apply $${suggestion.suggested_rate} for ${suggestion.date}`,
      cancelLabel: 'Close',
    });
    if (!wantsApply) return;

    await withLoading(async () => {
      try {
        const resp = await fetch('/api/admin/ops?resource=ml-optimization&endpoint=apply-suggestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: this.selectedSiteId, date: suggestion.date, suggestedRate: suggestion.suggested_rate }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await alertDialog({ title: 'Applied', message: `$${suggestion.suggested_rate} set for ${suggestion.date}.` });
      } catch (err) {
        console.error('Apply suggestion failed for', suggestion.date, err);
        await alertDialog({ title: 'Apply failed', message: `Could not update the rate for ${suggestion.date}. Please try again.` });
      }
    });
  }

  /**
   * Insert the "AI Insight" card, wired to whatever forecast is currently loaded.
   */
  renderAiInsight() {
    const slot = document.getElementById('mlAiInsightSlot');
    if (!slot || !this.currentForecast) return;
    slot.innerHTML = '';
    const site = this.sites.find((s) => s.id === this.selectedSiteId);
    const widget = renderAiInsightWidget('rate-optimization');
    widget.setBusy(() => ({
      siteName: site?.name || 'this site',
      currentRateUsd: this.currentForecast.current_rate,
      suggestedRateUsd: this.currentForecast.suggested_rate,
      confidencePercent: this.currentForecast.confidence,
      predictedOccupancyPercent: this.currentForecast.predicted_occupancy,
      estimatedDailyRevenueUsd: this.currentForecast.revenue_estimate,
    }));
    slot.appendChild(widget);
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
            message: `Data points: ${data.data_points_used}<br>Accuracy (MAE): &plusmn;$${data.accuracy_mae}/night`,
          });
          await this.loadModelStatus();
        } else {
          await alertDialog({ title: 'Training Error', message: data.error || 'Failed to train model' });
        }
      } catch (err) {
        console.error('Training error:', err);
        await alertDialog({ title: 'Error', message: 'Failed to train model' });
      }
    });
  }

  /**
   * Apply all calendar suggestions — actually changes what a guest pays on
   * each suggested date (via applyDynamicPriceOverride on the backend),
   * not just a cosmetic "done" message.
   */
  async applyAllSuggestions() {
    if (!this.currentSuggestions.length) {
      await alertDialog({ title: 'Nothing to apply', message: 'Load a month of suggestions first.' });
      return;
    }

    const confirm = await confirmDialog({
      title: 'Apply All Suggestions?',
      message: `This will update rates for all ${this.currentSuggestions.length} suggested dates. Are you sure?`,
    });

    if (!confirm) return;

    await withLoading(async () => {
      let succeeded = 0;
      let failed = 0;

      for (const sugg of this.currentSuggestions) {
        try {
          const resp = await fetch('/api/admin/ops?resource=ml-optimization&endpoint=apply-suggestion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId: this.selectedSiteId, date: sugg.date, suggestedRate: sugg.suggested_rate }),
          });
          if (resp.ok) succeeded++;
          else failed++;
        } catch (err) {
          console.error('Apply suggestion failed for', sugg.date, err);
          failed++;
        }
      }

      await alertDialog({
        title: 'Applied',
        message: failed
          ? `${succeeded} of ${this.currentSuggestions.length} dates updated — ${failed} failed. Check the console for details.`
          : `${succeeded} date${succeeded === 1 ? '' : 's'} updated with the suggested rate.`,
      });
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
