// Advanced Analytics Dashboard — interactive KPI cards, charts, heatmap,
// trends, forecasting, and guest segmentation for park staff. Loads data
// from /api/admin/features?resource=analytics, renders via vanilla DOM (no framework),
// respects dark mode, and exports CSV for offline analysis.

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

        <!-- KPI Cards -->
        <div class="kpi-grid">
          <div class="kpi-card glass">
            <div class="kpi-label">Total Revenue</div>
            <div class="kpi-value" id="kpiRevenue">$0</div>
            <div class="kpi-sub" id="kpiRevenueTrend"></div>
          </div>
          <div class="kpi-card glass">
            <div class="kpi-label">Occupancy %</div>
            <div class="kpi-value" id="kpiOccupancy">0%</div>
            <div class="kpi-sub" id="kpiOccupancyTrend"></div>
          </div>
          <div class="kpi-card glass">
            <div class="kpi-label">Average Daily Rate</div>
            <div class="kpi-value" id="kpiAdr">$0</div>
            <div class="kpi-sub" id="kpiAdrTrend"></div>
          </div>
          <div class="kpi-card glass">
            <div class="kpi-label">Repeat Guest %</div>
            <div class="kpi-value" id="kpiRepeatGuests">0%</div>
            <div class="kpi-sub" id="kpiRepeatGuestsSub"></div>
          </div>
        </div>

        <!-- Revenue Chart -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Revenue Trend</h3>
            <p class="sub">Daily revenue over the selected period</p>
          </div>
          <div class="chart-container">
            <canvas id="revenueChart" height="100"></canvas>
          </div>
        </div>

        <!-- Occupancy Heatmap -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Occupancy Heatmap</h3>
            <p class="sub">Site occupancy by date (30-day window)</p>
          </div>
          <div class="heatmap-container" id="heatmapContainer" style="overflow-x: auto;"></div>
        </div>

        <!-- Per-Site Metrics -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Revenue by Site</h3>
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
              <tbody id="sitesTableBody">
                <tr><td colspan="4" class="analytics-empty">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Booking Source Breakdown -->
        <div class="analytics-section glass">
          <div class="section-head">
            <h3>Booking Sources</h3>
            <p class="sub">Revenue by booking source</p>
          </div>
          <div class="sources-grid">
            <canvas id="sourcesChart" height="80"></canvas>
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
            <h3>Revenue Forecast</h3>
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
            <h3>Top Guests</h3>
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
            <h3>Guest Metrics</h3>
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

      // Load all analytics endpoints in parallel
      const [overview, trends, sites, forecasting, guests, sources, heatmap, dailyRevenue, topGuests] = await Promise.all([
        this.fetchAnalytics('overview'),
        this.fetchAnalytics('trends', { metric: 'revenue' }),
        this.fetchAnalytics('sites'),
        this.fetchAnalytics('forecasting', { days: '30' }),
        this.fetchAnalytics('guests'),
        this.fetchAnalytics('sources'),
        this.fetchAnalytics('heatmap', { startDate: this.getHeatmapStart(), endDate: this.getHeatmapEnd() }),
        this.fetchAnalytics('daily-revenue'),
        this.fetchAnalytics('top-guests', { limit: '10' }),
      ]);

      this.data = { overview, trends, sites, forecasting, guests, sources, heatmap, dailyRevenue, topGuests };

      this.renderKpiCards();
      this.renderRevenueChart();
      this.renderOccupancyHeatmap();
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
    document.getElementById('kpiRevenueTrend').textContent = this.formatTrend(trends.revenueTrendPercent);

    // Occupancy
    const occupancyPercent = overview.occupancy?.occupancyPercent || 0;
    document.getElementById('kpiOccupancy').textContent = `${occupancyPercent}%`;
    document.getElementById('kpiOccupancyTrend').textContent = this.formatTrend(trends.occupancyTrendPercent);

    // ADR
    const adrCents = overview.revenue?.adrCents || 0;
    document.getElementById('kpiAdr').textContent = this.formatCurrency(adrCents);
    document.getElementById('kpiAdrTrend').textContent = this.formatTrend(trends.adrTrendPercent);

    // Repeat guests
    const repeatGuestPercent = overview.guests?.repeatGuestPercent || 0;
    document.getElementById('kpiRepeatGuests').textContent = `${repeatGuestPercent}%`;
    document.getElementById('kpiRepeatGuestsSub').textContent = `${overview.guests?.uniqueGuestCount || 0} unique guests`;
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
    const tbody = document.getElementById('sitesTableBody');
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

    // Pie chart
    this.drawPieChart(canvas, sources, {
      colors: ['#4fc072', '#3a7fb0', '#157a72', '#d97f2e'],
    });

    // Table
    tbody.innerHTML = sources
      .map((src) => `
        <tr>
          <td>${this.escapeHtml(src.source)}</td>
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

    const dateKeys = Object.keys(heatmapData[0].dates || {}).sort();
    const columnWidth = Math.max(20, Math.min(40, 1200 / dateKeys.length));

    let html = `<div class="heatmap-grid" style="display: grid; gap: 1px; grid-template-columns: 120px repeat(${dateKeys.length}, ${columnWidth}px);">`;

    // Header row with dates
    html += '<div class="heatmap-label" style="grid-column: 1; padding: 8px; text-align: left; font-weight: 600;">Site</div>';
    dateKeys.forEach((date) => {
      html += `<div class="heatmap-date-header" style="grid-column: auto; padding: 4px; text-align: center; font-size: 0.75rem; writing-mode: vertical-rl;">${this.formatDate(date)}</div>`;
    });

    // Data rows
    heatmapData.slice(0, 20).forEach((site) => {
      html += `<div class="heatmap-site-label" style="grid-column: 1; padding: 8px; font-size: 0.875rem; border-right: 1px solid var(--border-glass);">${this.escapeHtml(site.siteName)}</div>`;

      dateKeys.forEach((date) => {
        const occupancy = site.dates[date] || 0;
        const intensity = occupancy > 0 ? 1 : 0.2;
        const bgColor = `rgba(79, 192, 114, ${intensity * 0.6})`;
        html += `<div class="heatmap-cell" style="grid-column: auto; background: ${bgColor}; min-height: 30px; border: 1px solid var(--border-glass);" title="${date}"></div>`;
      });
    });

    html += '</div>';
    return html;
  }

  drawLineChart(canvas, labels, values, opts = {}) {
    const ctx = canvas.getContext('2d');
    const { color, gridColor } = opts;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight || 300;

    // Scale canvas for retina displays
    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.scale(2, 2);

    // Dimensions and padding
    const padding = 40;
    const chartW = w - padding * 2;
    const chartH = h - padding * 2;

    // Clear
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartH * i) / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    // Find min/max
    const maxVal = Math.max(...values, 1);
    const minVal = 0;

    // Draw line
    if (values.length > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      values.forEach((val, i) => {
        const x = padding + (chartW * i) / (values.length - 1 || 1);
        const y = padding + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw points
      ctx.fillStyle = color;
      values.forEach((val, i) => {
        const x = padding + (chartW * i) / (values.length - 1 || 1);
        const y = padding + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Axes
    ctx.strokeStyle = 'var(--cream-dim)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, h - padding);
    ctx.lineTo(w - padding, h - padding);
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'var(--cream-dim)';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    labels.forEach((label, i) => {
      if (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1) {
        const x = padding + (chartW * i) / (labels.length - 1 || 1);
        ctx.fillText(label, x, h - 10);
      }
    });
  }

  drawPieChart(canvas, data, opts = {}) {
    const ctx = canvas.getContext('2d');
    const { colors } = opts;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight || 250;

    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.scale(2, 2);

    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) / 2 - 20;

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

  formatTrend(percent) {
    if (percent === undefined || percent === null) return '';
    const sign = percent > 0 ? '+' : '';
    const color = percent > 0 ? 'var(--amber-light)' : '#f0a89a';
    return `<span style="color: ${color}; font-size: 0.875rem;">${sign}${percent}% vs prev period</span>`;
  }

  getHeatmapStart() {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return start.toISOString().split('T')[0];
  }

  getHeatmapEnd() {
    return new Date().toISOString().split('T')[0];
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
