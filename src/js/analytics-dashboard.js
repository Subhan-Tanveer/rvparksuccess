// Advanced Analytics Dashboard — interactive KPI cards, charts, heatmap,
// trends, forecasting, and guest segmentation for park staff. Loads data
// from /api/admin/features?resource=analytics, renders via vanilla DOM (no framework),
// respects dark mode, and exports CSV for offline analysis.

import { renderAiInsightWidget } from './ai-insight-widget.js';
import { infoIcon } from './info-icon.js';

class AnalyticsDashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Container #${containerId} not found`);
      return;
    }

    this.selectedPeriod = '30d';
    this.data = {};
    this.chartInstances = {};
    // 0 = the week containing today; -1 = last week, +1 = next week, etc.
    this.heatmapWeekOffset = 0;
  }

  async init() {
    try {
      this.renderLayout();
      await this.loadData();
      this.attachEventListeners();
    } catch (err) {
      console.error('Analytics dashboard init error:', err);
      this.showError('Failed to initialize analytics dashboard');
    }
  }

  renderLayout() {
    this.container.innerHTML = `
      <div class="analytics-dashboard">
        <!-- Period Selector -->
        <div class="analytics-controls">
          <div class="period-selector">
            <button class="period-btn" data-period="7d">Last 7 days</button>
            <button class="period-btn is-active" data-period="30d">Last 30 days</button>
            <button class="period-btn" data-period="90d">Last 90 days</button>
          </div>
          <div class="export-controls">
            <button class="btn btn-ghost btn-sm" id="exportCsvBtn">
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <p class="form-note analytics-scope-note">Everything below looks <strong>backward</strong> from today over the period selected above — a different direction than the "Occupancy (Next 30d)" tile on the Overview tab, which looks forward instead.</p>

        <!-- KPI Cards -->
        <div class="kpi-grid">
          <div class="kpi-card glass">
            <div class="kpi-label">Total Revenue ${infoIcon('Total revenue collected from confirmed bookings during the selected period (e.g. "Last 30 days" = the 30 days ending today).')}</div>
            <div class="kpi-value" id="kpiRevenue">$0</div>
            <div class="kpi-sub" id="kpiRevenueTrend"></div>
          </div>
          <div class="kpi-card glass">
            <div class="kpi-label">Occupancy % ${infoIcon('Of all the site-nights available during the selected period, the percent that were actually booked — looking backward, ending today. Different from "Occupancy (Next 30d)" on the Overview tab, which looks forward at upcoming bookings instead.')}</div>
            <div class="kpi-value" id="kpiOccupancy">0%</div>
            <div class="kpi-sub" id="kpiOccupancyTrend"></div>
          </div>
          <div class="kpi-card glass">
            <div class="kpi-label">Average Daily Rate ${infoIcon('Average nightly rate guests actually paid, across confirmed bookings in the selected period.')}</div>
            <div class="kpi-value" id="kpiAdr">$0</div>
            <div class="kpi-sub" id="kpiAdrTrend"></div>
          </div>
          <div class="kpi-card glass">
            <div class="kpi-label">Repeat Guest % ${infoIcon('Percent of guests in this period who had booked with this park before.')}</div>
            <div class="kpi-value" id="kpiRepeatGuests">0%</div>
            <div class="kpi-sub" id="kpiRepeatGuestsSub"></div>
          </div>
        </div>

        <div id="analyticsAiInsightSlot"></div>

        <!-- Revenue Chart -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Revenue Trend ${infoIcon('Total revenue booked per day over the period selected above. Hover or click any point on the line for that exact day’s revenue.')}</h3>
            <p class="sub">Daily revenue over the selected period</p>
          </div>
          <div class="chart-container">
            <canvas id="revenueChart" height="100"></canvas>
          </div>
        </div>

        <!-- Occupancy Heatmap -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Occupancy Heatmap ${infoIcon('A 7-day grid showing which sites were booked on which dates. Darker cells mean more sites were occupied that day. Use the Previous/Next week buttons to look at a different week.')}</h3>
            <p class="sub">Site occupancy by date — one week at a time</p>
          </div>
          <div class="heatmap-week-nav" style="display:flex; align-items:center; justify-content:space-between; gap: var(--sp-2); margin-bottom: var(--sp-3);">
            <button type="button" class="btn btn-ghost btn-sm" id="heatmapPrevWeek"><span>&larr; Previous week</span></button>
            <span id="heatmapWeekLabel" style="font-size:0.9375rem; color: var(--cream-dim); font-weight:600;"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="heatmapNextWeek"><span>Next week &rarr;</span></button>
          </div>
          <div class="heatmap-container" id="heatmapContainer" style="overflow-x: auto;"></div>
        </div>

        <!-- Per-Site Metrics -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Revenue by Site ${infoIcon('Every site at your park, ranked by how much revenue it has generated: number of bookings, total revenue, and the average nightly rate guests actually paid.')}</h3>
            <p class="sub">Performance breakdown across all sites</p>
          </div>
          <div class="table-scroll">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Bookings</th>
                  <th>Revenue</th>
                  <th>Avg. Daily Rate</th>
                </tr>
              </thead>
              <tbody id="analyticsSitesTableBody">
                <tr><td colspan="4" class="analytics-empty">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Booking Source Breakdown -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Booking Sources ${infoIcon('Where your bookings are coming from (e.g. direct website, referral) and how much revenue each source has brought in — useful for knowing which channels are actually worth investing in.')}</h3>
            <p class="sub">Revenue by booking source</p>
          </div>
          <div class="sources-grid">
            <div class="sources-chart-wrap"><canvas id="sourcesChart"></canvas></div>
            <table class="source-details">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Bookings</th>
                  <th>%</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody id="sourcesTableBody"></tbody>
            </table>
          </div>
        </div>

        <!-- Forecast Card -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Revenue Forecast ${infoIcon('A projection of how much revenue the next 30 days should bring, based on your average nightly rate and your real occupancy rate over the selected period — not an assumption that every night sells.')}</h3>
            <p class="sub">Predicted revenue for next 30 days</p>
          </div>
          <div class="forecast-content">
            <div class="forecast-value" id="forecastValue">$0</div>
            <div class="forecast-range" id="forecastRange">Range: $0 - $0</div>
            <p class="forecast-sub">Based on recent booking velocity and historical patterns</p>
          </div>
        </div>

        <!-- Top Guests -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Top Guests ${infoIcon('Your highest-value guests this period, ranked by total revenue — how many times they’ve booked and how many nights total. Useful for spotting repeat guests worth reaching out to directly.')}</h3>
            <p class="sub">Highest-value repeat guests this period</p>
          </div>
          <div class="table-scroll">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>Guest Name</th>
                  <th>Email</th>
                  <th>Bookings</th>
                  <th>Total Nights</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody id="topGuestsTableBody">
                <tr><td colspan="5" class="analytics-empty">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Guest Metrics -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Guest Metrics ${infoIcon('High-level guest behavior stats: how long guests typically stay, what share of them are repeat visitors, and other retention signals for this period.')}</h3>
            <p class="sub">Guest retention and behavior</p>
          </div>
          <div class="metrics-grid">
            <div class="metric-item">
              <div class="metric-label">Avg. Stay Length</div>
              <div class="metric-value" id="metricAvgStay">—</div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Unique Guests</div>
              <div class="metric-value" id="metricUniqueGuests">—</div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Cancellation Rate</div>
              <div class="metric-value" id="metricCancellationRate">—</div>
            </div>
            <div class="metric-item">
              <div class="metric-label">Repeat Guest Rate</div>
              <div class="metric-value" id="metricRepeatRate">—</div>
            </div>
          </div>
        </div>

        <!-- Error Alert -->
        <div class="analytics-alert" id="analyticsAlert" style="display: none;"></div>
      </div>
    `;
  }

  attachEventListeners() {
    // Period selector
    document.querySelectorAll('.period-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('is-active'));
        e.target.classList.add('is-active');
        this.selectedPeriod = e.target.dataset.period;
        this.loadData();
      });
    });

    // Export CSV
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => this.exportCsv());

    // Occupancy heatmap week navigation
    document.getElementById('heatmapPrevWeek')?.addEventListener('click', () => {
      this.heatmapWeekOffset -= 1;
      this.loadHeatmapWeek();
    });
    document.getElementById('heatmapNextWeek')?.addEventListener('click', () => {
      this.heatmapWeekOffset += 1;
      this.loadHeatmapWeek();
    });

    // KPI card clicks (optional drill-down)
    document.querySelectorAll('.kpi-card').forEach((card) => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const metric = card.querySelector('.kpi-label')?.textContent || '';
        console.log('Drill down into:', metric);
      });
    });
  }

  async loadData() {
    try {
      this.showLoading(true);

      const heatmapWeek = this.getHeatmapWeekRange();

      // Load all analytics endpoints in parallel
      const [overview, trends, sites, forecasting, guests, sources, heatmap, dailyRevenue, topGuests] = await Promise.all([
        this.fetchAnalytics('overview'),
        this.fetchAnalytics('trends', { metric: 'revenue' }),
        this.fetchAnalytics('sites'),
        this.fetchAnalytics('forecasting', { days: '30' }),
        this.fetchAnalytics('guests'),
        this.fetchAnalytics('sources'),
        this.fetchAnalytics('heatmap', { startDate: heatmapWeek.start, endDate: heatmapWeek.end }),
        this.fetchAnalytics('daily-revenue'),
        this.fetchAnalytics('top-guests', { limit: '10' }),
      ]);

      this.data = { overview, trends, sites, forecasting, guests, sources, heatmap, dailyRevenue, topGuests };

      this.renderKpiCards();
      this.renderAiInsight();
      this.renderRevenueChart();
      this.renderOccupancyHeatmap();
      const heatmapLabelEl = document.getElementById('heatmapWeekLabel');
      if (heatmapLabelEl) heatmapLabelEl.textContent = this.formatHeatmapWeekLabel(heatmapWeek.start, heatmapWeek.end);
      this.renderSitesTable();
      this.renderSourcesChart();
      this.renderForecast();
      this.renderTopGuestsTable();
      this.renderGuestMetrics();

      this.showLoading(false);
    } catch (err) {
      console.error('Error loading analytics data:', err);
      this.showError('Failed to load analytics data');
    }
  }

  async fetchAnalytics(endpoint, params = {}) {
    const url = new URL('/api/admin/features', window.location.origin);
    url.searchParams.append('resource', 'analytics');
    url.searchParams.append('endpoint', endpoint);
    url.searchParams.append('period', this.selectedPeriod);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Analytics API error: ${response.status}`);
    }
    return response.json();
  }

  renderKpiCards() {
    const overview = this.data.overview || {};
    const trends = this.data.trends || {};

    // Revenue
    const totalRevenueCents = overview.revenue?.totalRevenueCents || 0;
    document.getElementById('kpiRevenue').textContent = this.formatCurrency(totalRevenueCents);
    document.getElementById('kpiRevenueTrend').innerHTML = this.formatTrend(trends.revenueTrendPercent);

    // Occupancy
    const occupancyPercent = overview.occupancy?.occupancyPercent || 0;
    document.getElementById('kpiOccupancy').textContent = `${occupancyPercent}%`;
    document.getElementById('kpiOccupancyTrend').innerHTML = this.formatTrend(trends.occupancyTrendPoints, 'pts');

    // ADR
    const adrCents = overview.revenue?.adrCents || 0;
    document.getElementById('kpiAdr').textContent = this.formatCurrency(adrCents);
    document.getElementById('kpiAdrTrend').innerHTML = this.formatTrend(trends.adrTrendPercent);

    // Repeat guests
    const repeatGuestPercent = overview.guests?.repeatGuestPercent || 0;
    document.getElementById('kpiRepeatGuests').textContent = `${repeatGuestPercent}%`;
    document.getElementById('kpiRepeatGuestsSub').textContent = `${overview.guests?.uniqueGuestCount || 0} unique guests`;
  }

  renderAiInsight() {
    const slot = document.getElementById('analyticsAiInsightSlot');
    if (!slot) return;
    slot.innerHTML = '';
    const overview = this.data.overview || {};
    const trends = this.data.trends || {};
    const sources = this.data.sources?.sources || [];
    const widget = renderAiInsightWidget('analytics');
    widget.setBusy(() => ({
      periodDays: this.selectedPeriod,
      totalRevenueUsd: (overview.revenue?.totalRevenueCents || 0) / 100,
      revenueTrendPercent: trends.revenueTrendPercent,
      occupancyPercent: overview.occupancy?.occupancyPercent,
      occupancyTrendPercentagePoints: trends.occupancyTrendPoints,
      adrUsd: (overview.revenue?.adrCents || 0) / 100,
      repeatGuestPercent: overview.guests?.repeatGuestPercent,
      uniqueGuestCount: overview.guests?.uniqueGuestCount,
      topBookingSources: sources.slice(0, 3).map((s) => ({ source: s.source, bookingPercent: s.bookingPercent })),
    }));
    slot.appendChild(widget);
  }

  // Re-draw the canvas-based charts using already-loaded data. The canvases
  // are sized from their container's rendered width (canvas.offsetWidth),
  // which is 0 while the analytics section is hidden (display:none) behind
  // the dashboard's tab-style sidebar navigation. Call this after the
  // "Advanced Analytics" tab is switched into view so the charts pick up
  // their real width instead of staying stuck at 0x0.
  redrawCharts() {
    this.renderRevenueChart();
    this.renderSourcesChart();
  }

  renderRevenueChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return;

    const dailyData = this.data.dailyRevenue?.data || [];
    const labels = dailyData.map((d) => this.formatDate(d.date));
    const values = dailyData.map((d) => d.revenueCents / 100);

    // Simple canvas-based line chart (no external library)
    this.drawLineChart(canvas, labels, values, {
      color: '#4fc072',
      accentColor: '#2e9b54',
      gridColor: 'rgba(245, 240, 232, 0.08)',
    });
  }

  renderOccupancyHeatmap() {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const heatmapData = this.data.heatmap?.heatmap || [];
    if (!heatmapData.length) {
      container.innerHTML = '<div class="analytics-empty">No occupancy data available</div>';
      return;
    }

    const html = this.buildHeatmapHtml(heatmapData);
    container.innerHTML = html;
  }

  renderSitesTable() {
    const tbody = document.getElementById('analyticsSitesTableBody');
    if (!tbody) return;

    const sites = this.data.sites?.sites || [];
    if (!sites.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="analytics-empty">No site data available</td></tr>';
      return;
    }

    tbody.innerHTML = sites
      .map((site) => `
        <tr>
          <td><strong>${this.escapeHtml(site.siteName)}</strong> <span style="color: var(--cream-dim); font-size: 0.875rem;">${this.escapeHtml(site.siteType)}</span></td>
          <td>${site.bookingCount}</td>
          <td>${this.formatCurrency(site.totalRevenueCents)}</td>
          <td>${this.formatCurrency(site.adrCents)}</td>
        </tr>
      `)
      .join('');
  }

  renderSourcesChart() {
    const canvas = document.getElementById('sourcesChart');
    const tbody = document.getElementById('sourcesTableBody');
    if (!canvas || !tbody) return;

    const sources = this.data.sources?.sources || [];
    if (!sources.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="analytics-empty">No source data available</td></tr>';
      return;
    }

    const colors = ['#4fc072', '#3a7fb0', '#157a72', '#d97f2e'];

    // Pie chart
    this.drawPieChart(canvas, sources, { colors });

    // Table — a colored dot per row ties each source back to its slice,
    // since color is otherwise the only thing connecting chart and table.
    tbody.innerHTML = sources
      .map((src, i) => `
        <tr>
          <td><span class="source-legend-dot" style="background:${colors[i % colors.length]}"></span>${this.escapeHtml(src.source)}</td>
          <td>${src.bookingCount}</td>
          <td>${src.bookingPercent}%</td>
          <td>${this.formatCurrency(src.totalRevenueCents)}</td>
        </tr>
      `)
      .join('');
  }

  renderForecast() {
    const forecast = this.data.forecasting || {};
    const predictedCents = forecast.predictedRevenueCents || 0;
    const lowerCents = forecast.lowerBoundCents || 0;
    const upperCents = forecast.upperBoundCents || 0;

    document.getElementById('forecastValue').textContent = this.formatCurrency(predictedCents);
    document.getElementById('forecastRange').textContent = `Range: ${this.formatCurrency(lowerCents)} - ${this.formatCurrency(upperCents)}`;
  }

  renderTopGuestsTable() {
    const tbody = document.getElementById('topGuestsTableBody');
    if (!tbody) return;

    const guests = this.data.topGuests?.guests || [];
    if (!guests.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="analytics-empty">No guest data available</td></tr>';
      return;
    }

    tbody.innerHTML = guests
      .map((guest) => `
        <tr>
          <td>${this.escapeHtml(guest.guestName)}</td>
          <td style="font-size: 0.875rem; color: var(--cream-dim);">${this.escapeHtml(guest.guestEmail)}</td>
          <td>${guest.bookingCount}</td>
          <td>${guest.totalNights}</td>
          <td>${this.formatCurrency(guest.totalRevenueCents)}</td>
        </tr>
      `)
      .join('');
  }

  renderGuestMetrics() {
    const guests = this.data.guests?.guestMetrics || {};

    document.getElementById('metricAvgStay').textContent = `${guests.avgStayNights || 0} nights`;
    document.getElementById('metricUniqueGuests').textContent = guests.uniqueGuestCount || 0;
    document.getElementById('metricCancellationRate').textContent = `${guests.cancellationPercent || 0}%`;
    document.getElementById('metricRepeatRate').textContent = `${guests.repeatGuestPercent || 0}%`;
  }

  buildHeatmapHtml(heatmapData) {
    if (!heatmapData.length) return '';

    const todayStr = new Date().toISOString().split('T')[0];
    const dateKeys = Object.keys(heatmapData[0].dates || {}).sort();
    const columnWidth = Math.max(20, Math.min(60, 1200 / dateKeys.length));

    let html = `<div class="heatmap-grid" style="display: grid; gap: 1px; grid-template-columns: 120px repeat(${dateKeys.length}, ${columnWidth}px);">`;

    // Header row with dates — today's column gets a highlighted border so
    // it's obvious at a glance which day is "now" within the week shown.
    html += '<div class="heatmap-label" style="grid-column: 1; padding: 8px; text-align: left; font-weight: 600;">Site</div>';
    dateKeys.forEach((date) => {
      const isToday = date === todayStr;
      html += `<div class="heatmap-date-header" style="grid-column: auto; padding: 4px; text-align: center; font-size: 0.75rem; writing-mode: vertical-rl; ${isToday ? 'color: var(--amber-light); font-weight: 700;' : ''}">${this.formatDate(date)}${isToday ? ' •' : ''}</div>`;
    });

    // Data rows
    heatmapData.slice(0, 20).forEach((site) => {
      html += `<div class="heatmap-site-label" style="grid-column: 1; padding: 8px; font-size: 0.875rem; border-right: 1px solid var(--border-glass);">${this.escapeHtml(site.siteName)}</div>`;

      dateKeys.forEach((date) => {
        const occupancy = site.dates[date] || 0;
        const intensity = occupancy > 0 ? 1 : 0.2;
        const bgColor = `rgba(79, 192, 114, ${intensity * 0.6})`;
        const isToday = date === todayStr;
        const border = isToday ? '2px solid var(--amber-light)' : '1px solid var(--border-glass)';
        html += `<div class="heatmap-cell" style="grid-column: auto; background: ${bgColor}; min-height: 30px; border: ${border};" title="${date}"></div>`;
      });
    });

    html += '</div>';
    return html;
  }

  drawLineChart(canvas, labels, values, opts = {}) {
    const ctx = canvas.getContext('2d');
    const { color, gridColor } = opts;
    // Canvas strokeStyle/fillStyle can't resolve CSS custom properties like
    // ctx.strokeStyle = 'var(--cream-dim)' — it silently no-ops, leaving
    // whatever color was last set (which is why axes/labels used to render
    // in the line's green instead of the intended dim cream). Resolve it
    // to a real color value up front instead.
    const axisColor = getComputedStyle(document.documentElement).getPropertyValue('--cream-dim').trim() || 'rgba(245, 240, 232, 0.7)';
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight || 300;

    // Scale canvas for retina displays
    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.scale(2, 2);

    // Dimensions and padding — right side gets less padding than left since
    // it has no y-axis labels to make room for.
    const padding = 56;
    const rightPadding = 16;
    const chartW = w - padding - rightPadding;
    const chartH = h - padding * 2;

    // Find min/max
    const maxVal = Math.max(...values, 1);
    const minVal = 0;

    const points = values.map((val, i) => ({
      x: padding + (chartW * i) / (values.length - 1 || 1),
      y: padding + chartH - ((val - minVal) / (maxVal - minVal)) * chartH,
      label: labels[i],
      value: val,
    }));

    const draw = (hoverIndex = -1) => {
      ctx.clearRect(0, 0, w, h);

      // Grid lines + y-axis dollar labels
      ctx.font = '11px Inter';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 5; i++) {
        const y = padding + (chartH * i) / 5;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(w - rightPadding, y);
        ctx.stroke();

        const gridVal = maxVal - (maxVal * i) / 5;
        ctx.fillStyle = axisColor;
        ctx.fillText(this.formatCurrency(gridVal * 100), padding - 10, y);
      }

      // Draw line
      if (points.length > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();

        // Draw points — the hovered/clicked point is drawn larger and ringed
        // so the tooltip has an obvious anchor.
        points.forEach((p, i) => {
          const isHover = i === hoverIndex;
          ctx.fillStyle = isHover ? '#ffffff' : color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, isHover ? 5 : 3, 0, Math.PI * 2);
          ctx.fill();
          if (isHover) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        });
      }

      // Axes
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, padding);
      ctx.lineTo(padding, h - padding);
      ctx.lineTo(w - rightPadding, h - padding);
      ctx.stroke();

      // X-axis date labels
      ctx.fillStyle = axisColor;
      ctx.font = '12px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      labels.forEach((label, i) => {
        if (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1) {
          const x = padding + (chartW * i) / (labels.length - 1 || 1);
          ctx.fillText(label, x, h - 10);
        }
      });
    };

    draw();

    // Appended to <body> with position: fixed rather than inside the chart
    // card — any ancestor's overflow:hidden (the chart container has one,
    // to stop the canvas itself spawning a scrollbar) or z-index/stacking
    // context would otherwise clip or bury the tooltip. A fixed-position
    // element escapes all of that entirely. Reused across redraws (this
    // function re-runs whenever the dashboard's period filter changes or
    // the window resizes) rather than recreated each time.
    let tooltip = document._chartTooltipEl;
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'chart-tooltip';
      tooltip.style.display = 'none';
      document.body.appendChild(tooltip);
      document._chartTooltipEl = tooltip;
    }

    const showTooltip = (clientX) => {
      if (!points.length) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      let nearest = 0;
      let nearestDist = Infinity;
      points.forEach((p, i) => {
        const dist = Math.abs(p.x - mouseX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      });
      draw(nearest);
      const p = points[nearest];
      const pointX = rect.left + p.x;
      const pointY = rect.top + p.y;
      tooltip.textContent = `${p.label}: ${this.formatCurrency(p.value * 100)}`;
      tooltip.style.left = `${pointX}px`;
      tooltip.style.top = `${pointY}px`;
      // Flip downward instead of upward whenever there isn't roughly a
      // tooltip's-height of room above the point on screen.
      tooltip.classList.toggle('is-below', pointY < 44);
      tooltip.style.display = 'block';
    };

    const hideTooltip = () => {
      draw();
      tooltip.style.display = 'none';
    };

    // Assigning onmousemove/onclick (rather than addEventListener) means
    // each redraw replaces the old handler instead of stacking a new one.
    canvas.onmousemove = (e) => showTooltip(e.clientX);
    canvas.onclick = (e) => showTooltip(e.clientX);
    canvas.onmouseleave = hideTooltip;
  }

  drawPieChart(canvas, data, opts = {}) {
    const ctx = canvas.getContext('2d');
    const { colors } = opts;
    const w = canvas.offsetWidth || 250;
    const h = canvas.offsetHeight || 250;

    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.scale(2, 2);

    const centerX = w / 2;
    const centerY = h / 2;
    // Canvas can still be 0-width the instant this runs (e.g. its tab/section
    // isn't visible yet, so it has no laid-out size) even with the fallback
    // above kicking in for a fully-detached canvas — clamp so a small or
    // momentarily-invisible container never produces a negative radius.
    const radius = Math.max(Math.min(w, h) / 2 - 20, 10);

    let currentAngle = -Math.PI / 2;
    const total = data.reduce((sum, d) => sum + d.bookingCount, 0);

    data.forEach((item, i) => {
      const sliceAngle = (item.bookingCount / total) * Math.PI * 2;

      // Draw slice
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
      ctx.lineTo(centerX, centerY);
      ctx.fill();

      // Draw label
      const labelAngle = currentAngle + sliceAngle / 2;
      const labelX = centerX + Math.cos(labelAngle) * (radius * 0.6);
      const labelY = centerY + Math.sin(labelAngle) * (radius * 0.6);

      ctx.fillStyle = '#f5f0e8';
      ctx.font = 'bold 12px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pct = Math.round((item.bookingCount / total) * 100);
      if (pct > 5) {
        ctx.fillText(`${pct}%`, labelX, labelY);
      }

      currentAngle += sliceAngle;
    });
  }

  exportCsv() {
    const rows = [['RVPark Analytics Export', this.selectedPeriod].join(',')];

    // Revenue data
    rows.push(['']);
    rows.push(['REVENUE SUMMARY']);
    const overview = this.data.overview || {};
    rows.push(['Total Revenue', this.formatCurrency(overview.revenue?.totalRevenueCents)]);
    rows.push(['ADR', this.formatCurrency(overview.revenue?.adrCents)]);
    rows.push(['Bookings', overview.revenue?.bookingCount || 0]);

    // Occupancy data
    rows.push(['']);
    rows.push(['OCCUPANCY SUMMARY']);
    rows.push(['Occupancy %', (overview.occupancy?.occupancyPercent || 0) + '%']);
    rows.push(['Booked Site-Nights', overview.occupancy?.bookedSiteNights || 0]);

    // Guest data
    rows.push(['']);
    rows.push(['GUEST METRICS']);
    const guests = this.data.guests?.guestMetrics || {};
    rows.push(['Unique Guests', guests.uniqueGuestCount || 0]);
    rows.push(['Repeat Guest %', (guests.repeatGuestPercent || 0) + '%']);
    rows.push(['Avg Stay', (guests.avgStayNights || 0) + ' nights']);

    // Sites
    rows.push(['']);
    rows.push(['SITE PERFORMANCE']);
    rows.push(['Site', 'Bookings', 'Revenue', 'ADR']);
    const sites = this.data.sites?.sites || [];
    sites.forEach((site) => {
      rows.push([site.siteName, site.bookingCount, this.formatCurrency(site.totalRevenueCents), this.formatCurrency(site.adrCents)]);
    });

    // Download
    const csv = rows.map((r) => (Array.isArray(r) ? r.map((v) => `"${v}"`).join(',') : r)).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rvpark-analytics-${this.selectedPeriod}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Utility functions
  formatCurrency(cents) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100);
  }

  formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00Z');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // unit defaults to a relative '%' change (revenue/ADR/bookings). Occupancy
  // is already a percentage, so its trend is a percentage-POINT delta, not
  // a relative percent change — pass unit: 'pts' there so e.g. "+16.7pts"
  // doesn't read as "occupancy grew 16.7%", which is a different claim.
  formatTrend(value, unit = '%') {
    if (value === undefined || value === null) return '';
    const sign = value > 0 ? '+' : '';
    const color = value > 0 ? 'var(--amber-light)' : '#f0a89a';
    const suffix = unit === 'pts' ? 'pts' : '%';
    const title = unit === 'pts'
      ? `Occupancy was ${sign}${value} percentage points vs. the same-length period before this one (e.g. 20% → 36.7% shows as "+16.7pts").`
      : `Change vs. the same-length period right before this one.`;
    return `<span title="${title}" style="color: ${color}; font-size: 0.875rem; cursor: help;">${sign}${value}${suffix} vs prev period</span>`;
  }

  // Sunday-to-Saturday week containing today, shifted by heatmapWeekOffset
  // weeks — offset 0 (the default) always includes today, regardless of
  // when in the week "today" falls, unlike a fixed trailing/leading window.
  getHeatmapWeekRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() + this.heatmapWeekOffset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }

  formatHeatmapWeekLabel(start, end) {
    const startD = new Date(start);
    const endD = new Date(end);
    const opts = { month: 'short', day: 'numeric' };
    const label = `${startD.toLocaleDateString('en-US', opts)} – ${endD.toLocaleDateString('en-US', opts)}`;
    return this.heatmapWeekOffset === 0 ? `${label} (this week)` : label;
  }

  async loadHeatmapWeek() {
    const { start, end } = this.getHeatmapWeekRange();
    const labelEl = document.getElementById('heatmapWeekLabel');
    if (labelEl) labelEl.textContent = this.formatHeatmapWeekLabel(start, end);
    try {
      this.data.heatmap = await this.fetchAnalytics('heatmap', { startDate: start, endDate: end });
      this.renderOccupancyHeatmap();
    } catch (err) {
      console.error('Error loading heatmap week:', err);
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showLoading(isLoading) {
    const sections = this.container.querySelectorAll('.analytics-section, .kpi-grid');
    sections.forEach((s) => {
      s.style.opacity = isLoading ? '0.5' : '1';
      s.style.pointerEvents = isLoading ? 'none' : 'auto';
    });
  }

  showError(message) {
    const alert = document.getElementById('analyticsAlert');
    if (alert) {
      alert.textContent = message;
      alert.style.display = 'block';
    }
  }
}

// Export for use in park-dashboard.js
export default AnalyticsDashboard;
