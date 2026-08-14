// Occupancy Forecasting Dashboard — interactive visualizations of 90-day
// forecasts, seasonal patterns, booking pace, capacity utilization, and
// staffing recommendations. Renders via vanilla DOM (no framework).

export async function initializeOccupancyForecastingDashboard() {
  const container = document.getElementById('occupancyForecastingDashboard');
  if (!container) {
    console.error('Container #occupancyForecastingDashboard not found');
    return;
  }

  try {
    renderLayout(container);
    await loadData(container);
    attachEventListeners(container);
  } catch (err) {
    console.error('Occupancy forecasting dashboard error:', err);
    showError(container, 'Failed to initialize forecasting dashboard');
  }
}

function renderLayout(container) {
  container.innerHTML = `
    <div class="occupancy-forecasting">
      <!-- Section: 90-Day Forecast -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>90-Day Occupancy Forecast</h3>
          <p class="sub">Predicted occupancy % with confidence intervals</p>
        </div>
        <div class="ocf-chart-wrapper">
          <canvas id="occupancyForecastChart" height="80"></canvas>
        </div>
        <div class="ocf-info-row">
          <span class="info-item">
            <span class="info-label">Today's Occupancy:</span>
            <span class="info-value" id="todayOccupancy">—</span>
          </span>
          <span class="info-item">
            <span class="info-label">30-Day Average:</span>
            <span class="info-value" id="avg30Occupancy">—</span>
          </span>
          <span class="info-item">
            <span class="info-label">90-Day Average:</span>
            <span class="info-value" id="avg90Occupancy">—</span>
          </span>
          <span class="info-item">
            <span class="info-label">Trend:</span>
            <span class="info-value" id="occupancyTrend">—</span>
          </span>
        </div>
      </div>

      <!-- Section: Seasonal Calendar -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Seasonal Calendar</h3>
          <p class="sub">12-month occupancy heatmap</p>
        </div>
        <div id="seasonalCalendarContainer" class="seasonal-calendar-container">
          Loading...
        </div>
      </div>

      <!-- Section: Booking Pace -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Booking Pace Analysis</h3>
          <p class="sub">Are you booking faster or slower than usual?</p>
        </div>
        <div class="pace-grid" id="paceGrid">
          <div class="pace-card">
            <div class="pace-label">Booking Pace</div>
            <div class="pace-index" id="paceIndex">—</div>
            <div class="pace-sub" id="paceInterpretation">—</div>
          </div>
          <div class="pace-card">
            <div class="pace-label">Avg. Lead Time</div>
            <div class="pace-days" id="paceLeadDays">—</div>
            <div class="pace-sub">days in advance</div>
          </div>
          <div class="pace-card">
            <div class="pace-label">Anomalies</div>
            <div class="pace-count" id="anomalyCount">—</div>
            <div class="pace-sub">unusual bookings</div>
          </div>
        </div>
      </div>

      <!-- Section: Capacity Utilization -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Capacity Utilization</h3>
          <p class="sub">How much of your available capacity are you selling?</p>
        </div>
        <div class="capacity-gauge-wrapper">
          <div class="gauge-container">
            <svg class="capacity-gauge" viewBox="0 0 200 120" id="capacityGauge">
              <path class="gauge-bg" d="M 30 100 A 70 70 0 0 1 170 100" />
              <path class="gauge-fill" d="M 30 100 A 70 70 0 0 1 170 100" />
              <text x="100" y="95" class="gauge-value" id="gaugeValue">—%</text>
            </svg>
          </div>
          <div class="gauge-details" id="gaugeDetails">
            <div class="detail-row">
              <span class="detail-label">Target:</span>
              <span class="detail-value">85%</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Current:</span>
              <span class="detail-value" id="currentUtilization">—</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Gap:</span>
              <span class="detail-value" id="utilizationGap">—</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Section: Underutilized Dates -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Underutilized Dates</h3>
          <p class="sub">Opportunities for promotions or discounts</p>
        </div>
        <div class="table-scroll">
          <table class="ocf-table">
            <thead>
              <tr>
                <th>Date Range</th>
                <th>Nights</th>
                <th>Forecast</th>
                <th>Potential Loss</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody id="underutilizedTableBody">
              <tr><td colspan="5" class="ocf-empty">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section: Staffing Recommendations -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Staffing Recommendations</h3>
          <p class="sub">Next 90 days staffing level guidance</p>
        </div>
        <div class="staffing-timeline" id="staffingTimeline">
          Loading...
        </div>
      </div>

      <!-- Section: Peak Season Prediction -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Peak Season Prediction</h3>
          <p class="sub">When is your next high-occupancy period?</p>
        </div>
        <div class="peak-card" id="peakCard">
          <div class="peak-label">Next Peak Season</div>
          <div class="peak-dates" id="peakDates">—</div>
          <div class="peak-expected" id="peakExpected">—</div>
          <div class="peak-countdown" id="peakCountdown">—</div>
        </div>
      </div>

      <!-- Section: Trend Analysis -->
      <div class="ocf-section glass">
        <div class="section-head">
          <h3>Occupancy Trend (365 days)</h3>
          <p class="sub">Is occupancy improving or declining over time?</p>
        </div>
        <div class="trend-analysis" id="trendAnalysis">
          <div class="trend-stat">
            <span class="trend-label">Direction:</span>
            <span class="trend-value" id="trendDirection">—</span>
          </div>
          <div class="trend-stat">
            <span class="trend-label">Slope:</span>
            <span class="trend-value" id="trendSlope">—</span>
          </div>
          <div class="trend-stat">
            <span class="trend-label">Change (year):</span>
            <span class="trend-value" id="trendChange">—</span>
          </div>
          <div class="trend-stat">
            <span class="trend-label">Model Fit (R²):</span>
            <span class="trend-value" id="trendR2">—</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadData(container) {
  try {
    // Load all data in parallel
    const [forecast, seasonal, pace, underutilized, staffing, peak, trend, utilization, anomalies] =
      await Promise.all([
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=forecast&days=90').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=seasonal-calendar&year=2026').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=booking-pace').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=underutilized').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=staffing-recommendations').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=peak-prediction').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=trend&days=365').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=capacity-utilization').then((r) => r.json()),
        fetch('/api/admin/ops?resource=occupancy-forecasting&endpoint=anomalies').then((r) => r.json()),
      ]);

    // Render sections
    renderForecastChart(container, forecast.forecast || []);
    renderSeasonalCalendar(container, seasonal.calendar || []);
    renderBookingPace(container, pace);
    renderCapacityGauge(container, utilization);
    renderUnderutilizedTable(container, underutilized.underutilized || []);
    renderStaffingTimeline(container, staffing.recommendations || []);
    renderPeakPrediction(container, peak.peak);
    renderTrendAnalysis(container, trend);
    renderAnomalies(container, anomalies.anomalies || []);
  } catch (error) {
    console.error('Error loading forecasting data:', error);
    showError(container, 'Failed to load forecast data');
  }
}

function renderForecastChart(container, forecast) {
  const canvas = container.querySelector('#occupancyForecastChart');
  if (!canvas || forecast.length === 0) return;

  // Simple line chart using canvas
  const ctx = canvas.getContext('2d');
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;

  // Set canvas resolution
  canvas.width = width;
  canvas.height = height;

  const padding = 40;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Draw background
  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, width, height);

  // Draw grid and axes
  ctx.strokeStyle = 'rgba(100, 100, 100, 0.2)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';

  // Y-axis labels
  for (let i = 0; i <= 5; i++) {
    const y = padding + (i * chartHeight) / 5;
    const value = 100 - i * 20;
    ctx.fillText(value + '%', 20, y + 4);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  // X-axis
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // Draw confidence interval (shaded area)
  ctx.fillStyle = 'rgba(100, 180, 255, 0.1)';
  ctx.beginPath();
  for (let i = 0; i < forecast.length; i++) {
    const x = padding + (i / forecast.length) * chartWidth;
    const upper = ((100 - forecast[i].confidenceUpper) / 100) * chartHeight;
    const y = padding + upper;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = forecast.length - 1; i >= 0; i--) {
    const x = padding + (i / forecast.length) * chartWidth;
    const lower = ((100 - forecast[i].confidenceLower) / 100) * chartHeight;
    const y = padding + lower;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Draw forecast line
  ctx.strokeStyle = '#4da8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < forecast.length; i++) {
    const x = padding + (i / forecast.length) * chartWidth;
    const y = padding + ((100 - forecast[i].forecastOccupancy) / 100) * chartHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Update summary stats
  const avg30 = Math.round(
    forecast.slice(0, 30).reduce((sum, d) => sum + d.forecastOccupancy, 0) / 30
  );
  const avg90 = Math.round(
    forecast.reduce((sum, d) => sum + d.forecastOccupancy, 0) / forecast.length
  );
  const trend = forecast[forecast.length - 1]?.trend || 'stable';

  container.querySelector('#avg30Occupancy').textContent = avg30 + '%';
  container.querySelector('#avg90Occupancy').textContent = avg90 + '%';
  container.querySelector('#occupancyTrend').textContent =
    trend === 'improving' ? '↑ Improving'
      : trend === 'declining' ? '↓ Declining'
        : '→ Stable';

  if (forecast.length > 0) {
    container.querySelector('#todayOccupancy').textContent = Math.round(forecast[0].forecastOccupancy) + '%';
  }
}

function renderSeasonalCalendar(container, calendar) {
  const calendarContainer = container.querySelector('#seasonalCalendarContainer');
  if (!calendar || calendar.length === 0) {
    calendarContainer.innerHTML = '<p class="ocf-empty">No calendar data available</p>';
    return;
  }

  let html = '<div class="seasonal-months">';

  for (const month of calendar) {
    const monthColor = getSeasonColor(month.season);
    html += `
      <div class="seasonal-month" style="border-left: 4px solid ${monthColor};">
        <div class="month-header">
          <span class="month-name">${month.monthName} ${month.year}</span>
          <span class="month-occ">${month.averageOccupancy}%</span>
        </div>
        <div class="month-days">
          ${month.days
            .map((d) => {
              const bgColor = getOccupancyColor(d.occupancy);
              const border = d.isWeekend ? '1px solid rgba(255,255,255,0.3)' : 'none';
              return `
              <div class="day-cell" style="background-color: ${bgColor}; border: ${border};" title="${d.date}: ${d.occupancy}%">
                <span class="day-num">${d.day}</span>
              </div>
            `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';
  calendarContainer.innerHTML = html;
}

function renderBookingPace(container, pace) {
  if (!pace) return;

  const paceIndex = pace.bookingPaceIndex || 100;
  const interpretation = pace.interpretation || 'Normal pace';
  const leadDays = pace.expectedDaysBooked || 40;

  container.querySelector('#paceIndex').textContent = paceIndex + '%';
  container.querySelector('#paceInterpretation').textContent = interpretation;
  container.querySelector('#paceLeadDays').textContent = leadDays;
}

function renderCapacityGauge(container, utilization) {
  if (!utilization) return;

  const percent = utilization.utilizationPercent || 0;
  const current = Math.round(percent * 10) / 10;
  const gap = Math.max(0, 85 - current);

  container.querySelector('#gaugeValue').textContent = current.toFixed(1) + '%';
  container.querySelector('#currentUtilization').textContent = current.toFixed(1) + '%';
  container.querySelector('#utilizationGap').textContent = gap > 0 ? '+' + gap.toFixed(1) + '%' : 'Target met!';

  // Update gauge fill
  const svg = container.querySelector('#capacityGauge');
  const fill = svg?.querySelector('.gauge-fill');
  if (fill) {
    const pathLength = 131.95; // Approximate circumference
    const dashoffset = pathLength * (1 - percent / 100);
    fill.style.strokeDasharray = pathLength;
    fill.style.strokeDashoffset = dashoffset;
    fill.style.stroke = percent >= 85 ? '#4CAF50' : percent >= 70 ? '#FF9800' : '#f44336';
  }
}

function renderUnderutilizedTable(container, underutilized) {
  const tbody = container.querySelector('#underutilizedTableBody');
  if (underutilized.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="ocf-empty">No underutilized periods identified</td></tr>';
    return;
  }

  tbody.innerHTML = underutilized.map((u) => `
    <tr>
      <td>${u.startDate} to ${u.endDate}</td>
      <td>${u.nights}</td>
      <td>${u.averageOccupancy}%</td>
      <td>$${(u.potentialRevenueLoss / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
      <td class="recommendation-cell">${u.recommendation}</td>
    </tr>
  `).join('');
}

function renderStaffingTimeline(container, recommendations) {
  const timeline = container.querySelector('#staffingTimeline');
  if (!recommendations || recommendations.length === 0) {
    timeline.innerHTML = '<p class="ocf-empty">No staffing recommendations available</p>';
    return;
  }

  let html = '<div class="staffing-bars">';
  for (const rec of recommendations.slice(0, 12)) {
    const color = getStaffingColor(rec.level);
    const occupancy = Math.round(rec.occupancy);
    html += `
      <div class="staffing-period">
        <div class="period-bar" style="background-color: ${color};">
          <span class="period-occ">${occupancy}%</span>
        </div>
        <div class="period-info">
          <div class="period-dates">${rec.startDate} → ${rec.endDate}</div>
          <div class="period-recommendation">${rec.recommendation}</div>
          <div class="period-adjustment" style="color: ${color};">${rec.staffAdjustment}</div>
        </div>
      </div>
    `;
  }
  html += '</div>';
  timeline.innerHTML = html;
}

function renderPeakPrediction(container, peak) {
  const card = container.querySelector('#peakCard');
  if (!peak) {
    card.innerHTML = '<p class="ocf-empty">Insufficient data to predict peak season</p>';
    return;
  }

  const today = new Date();
  const peakStart = new Date(peak.startDate);
  const daysUntil = Math.ceil((peakStart - today) / (1000 * 60 * 60 * 24));

  card.innerHTML = `
    <div class="peak-label">Next Peak Season</div>
    <div class="peak-dates">${peak.startDate} to ${peak.endDate}</div>
    <div class="peak-expected">Expected Occupancy: ${peak.expectedOccupancy}%</div>
    <div class="peak-countdown">${daysUntil > 0 ? daysUntil + ' days away' : 'Happening now!'}</div>
  `;
}

function renderTrendAnalysis(container, trend) {
  if (!trend) return;

  const direction = trend.direction || '→';
  const slope = (trend.slope || 0).toFixed(2);
  const change = (trend.changePercent || 0).toFixed(1);
  const r2 = (trend.r2 || 0).toFixed(3);

  container.querySelector('#trendDirection').textContent = direction + ' ' + (trend.trend || 'stable');
  container.querySelector('#trendSlope').textContent = slope + '% per day';
  container.querySelector('#trendChange').textContent = (change >= 0 ? '+' : '') + change + '%';
  container.querySelector('#trendR2').textContent = r2;
}

function renderAnomalies(container, anomalies) {
  container.querySelector('#anomalyCount').textContent = anomalies.length;
}

function attachEventListeners(container) {
  // Could add interactive features like date range picker, export buttons, etc.
}

function showError(container, message) {
  const existing = container.querySelector('.error-message');
  if (existing) existing.remove();

  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  container.prepend(errorDiv);
}

function getSeasonColor(season) {
  switch (season) {
    case 'peak':
      return '#4CAF50';
    case 'shoulder':
      return '#FF9800';
    case 'low':
      return '#2196F3';
    default:
      return '#9E9E9E';
  }
}

function getOccupancyColor(occupancy) {
  // Color scale: low (red) to high (green)
  if (occupancy >= 80) return 'rgba(76, 175, 80, 0.8)'; // Green
  if (occupancy >= 60) return 'rgba(255, 193, 7, 0.8)'; // Yellow
  if (occupancy >= 40) return 'rgba(255, 152, 0, 0.8)'; // Orange
  return 'rgba(244, 67, 54, 0.8)'; // Red
}

function getStaffingColor(level) {
  switch (level) {
    case 'high':
      return '#4CAF50';
    case 'medium':
      return '#FF9800';
    case 'low':
      return '#2196F3';
    default:
      return '#9E9E9E';
  }
}
