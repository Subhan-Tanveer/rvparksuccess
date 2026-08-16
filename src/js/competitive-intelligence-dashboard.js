// Competitive Intelligence Dashboard — UI for market positioning, competitor tracking, price recommendations
// Renders market overview, competitor list, price comparisons, trends, and opportunities

import { openAddCompetitorModal } from './competitor-map-modal.js';

let dashboardData = null;
let comparisonTimeframe = 30;

async function initializeCompetitiveIntelligenceDashboard() {
  const container = document.getElementById('competitiveIntelligenceDashboard');
  if (!container) return;

  try {
    // Fetch dashboard summary data
    const response = await fetch('/api/admin/ops?resource=competitive-intelligence&action=dashboard-summary');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dashboardData = await response.json();

    renderMarketOverview(container);
    renderCompetitorTracking(container);
    renderPriceComparison(container);
    renderPricingOpportunities(container);
    renderMarketTrends(container);
    renderAlerts(container);
  } catch (err) {
    console.error('Failed to initialize competitive intelligence dashboard:', err);
    renderErrorState(container, 'Failed to load competitive intelligence data');
  }
}

/* ============================================================ */
/* Risk Alerts — Red/Yellow/Green banners */
/* ============================================================ */

function renderAlerts(container) {
  if (!dashboardData) return;

  const alertsContainer = document.createElement('div');
  const { opportunities, positioning } = dashboardData;

  // Check for risk conditions
  const alerts = [];

  // Alert 1: Significantly overpriced
  let hasOverpriced = false;
  if (positioning) {
    for (const [siteType, data] of Object.entries(positioning)) {
      if (data && data.position && data.position.percentageDifference > 15) {
        hasOverpriced = true;
        alerts.push({
          type: 'danger',
          title: 'Overpriced Alert',
          message: `Your ${siteType}s are ${data.position.percentageDifference}% above market average. Consider reducing rates to improve occupancy.`,
        });
      }
    }
  }

  // Alert 2: Pricing opportunities available
  if (opportunities && opportunities.length > 0) {
    const positiveOps = opportunities.filter((o) => o.estimatedRevenueImpactMonth > 0);
    if (positiveOps.length > 0) {
      alerts.push({
        type: 'success',
        title: 'Revenue Opportunity',
        message: `Identified ${positiveOps.length} site(s) where rate increases could boost revenue. See recommendations below.`,
      });
    }
  }

  // Alert 3: New competitors detected (if tracked count increased)
  if (dashboardData.summary && dashboardData.summary.competitorsTracked > 0) {
    alerts.push({
      type: 'warning',
      title: 'Market Intel',
      message: `Monitoring ${dashboardData.summary.competitorsTracked} competitor(s). Last updated ${new Date(dashboardData.lastUpdated).toLocaleDateString()}.`,
    });
  }

  // Render alerts
  alerts.forEach((alert) => {
    const alertEl = document.createElement('div');
    alertEl.className = `ci-alert is-visible is-${alert.type}`;
    alertEl.innerHTML = `<strong>${alert.title}:</strong> ${alert.message}`;
    alertsContainer.appendChild(alertEl);
  });

  container.insertBefore(alertsContainer, container.firstChild);
}

/* ============================================================ */
/* Market Overview Card */
/* ============================================================ */

function renderMarketOverview(container) {
  if (!dashboardData) return;

  const section = document.createElement('div');
  section.className = 'ci-market-overview';

  const { positioning, summary } = dashboardData;
  if (!positioning || Object.keys(positioning).length === 0) {
    section.innerHTML = `
      <div class="ci-empty-state">
        <p>No competitor data available yet. Add competitors to start tracking market rates.</p>
      </div>
    `;
    container.appendChild(section);
    return;
  }

  let html = `
    <div class="section-head">
      <p class="eyebrow">Market Intelligence</p>
      <h2>Market Overview</h2>
    </div>
    <div class="ci-metrics-grid">
  `;

  // Show market position for each site type
  for (const [siteType, data] of Object.entries(positioning)) {
    if (!data) continue;

    const yourRate = data.yourAvgRate;
    const marketAvg = data.marketAverage;
    const marketMin = data.marketMin;
    const marketMax = data.marketMax;

    const positionPercentage = data.position ? data.position.percentageDifference : 0;
    const positionLabel = data.position ? data.position.positionLabel : 'Unknown';

    let badgeClass = 'is-neutral';
    if (positionLabel === 'Underpriced') badgeClass = 'is-risk';
    if (positionLabel === 'Overpriced') badgeClass = 'is-risk';
    if (positionLabel === 'Market-matched' || positionLabel === 'Competitive') badgeClass = 'is-good';

    html += `
      <div class="ci-metric-card">
        <div class="label">${siteType}</div>
        <div class="value">$${(yourRate / 100).toFixed(2)}</div>
        <div class="sub">Your Rate</div>
        <div class="sub" style="margin-top: 6px;">Market: $${(marketAvg / 100).toFixed(2)} avg</div>
        <span class="ci-position-badge ${badgeClass}">${positionLabel}</span>
      </div>
    `;
  }

  html += '</div>';

  // Market insights
  html += `
    <div class="ci-stats-summary">
      <div class="ci-stat">
        <div class="value">${summary.competitorsTracked}</div>
        <div class="label">Competitors</div>
      </div>
      <div class="ci-stat">
        <div class="value">${summary.sitesManaged}</div>
        <div class="label">Your Sites</div>
      </div>
      <div class="ci-stat">
        <div class="value">${summary.opportunitiesIdentified}</div>
        <div class="label">Opportunities</div>
      </div>
    </div>
  `;

  section.innerHTML = html;
  container.appendChild(section);
}

/* ============================================================ */
/* Competitor Tracking Section */
/* ============================================================ */

function renderCompetitorTracking(container) {
  const section = document.createElement('div');
  section.className = 'ci-competitor-section';

  const heading = document.createElement('div');
  heading.className = 'section-head';
  heading.innerHTML = `
    <div>
      <p class="eyebrow">Tracking</p>
      <h2>Competitors</h2>
    </div>
    <button class="btn btn-ghost btn-sm" id="addCompetitorBtn">
      <span>Add Competitor</span>
    </button>
  `;
  section.appendChild(heading);

  // Competitors table
  const table = document.createElement('table');
  table.className = 'ci-competitor-table';

  if (!dashboardData || dashboardData.summary.competitorsTracked === 0) {
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="ci-empty-state">No competitors tracked yet. Add one to get started.</td>';
    tbody.appendChild(tr);
    table.appendChild(tbody);
  } else {
    table.innerHTML = `
      <thead>
        <tr>
          <th>Competitor</th>
          <th>Avg Rate</th>
          <th>Range</th>
          <th>Last Updated</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="competitorsTableBody">
        <tr><td colspan="5" class="ci-empty-state">Loading...</td></tr>
      </tbody>
    `;
  }

  section.appendChild(table);
  container.appendChild(section);

  // Event handlers
  document.getElementById('addCompetitorBtn').addEventListener('click', async () => {
    const added = await openAddCompetitorModal();
    if (added) initializeCompetitiveIntelligenceDashboard();
  });

  // Load competitors
  loadCompetitors();
}

async function loadCompetitors() {
  try {
    const response = await fetch('/api/admin/ops?resource=competitive-intelligence&action=competitors');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const tbody = document.getElementById('competitorsTableBody');
    if (!tbody) return;

    if (!data.competitors || data.competitors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="ci-empty-state">No competitors tracked yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.competitors.map((comp) => `
      <tr>
        <td class="comp-name">${escapeHtml(comp.name)}</td>
        <td class="comp-rate">—</td>
        <td class="comp-status">Monitoring</td>
        <td class="comp-status">${comp.lastScraped ? new Date(comp.lastScraped).toLocaleDateString() : 'Not yet'}</td>
        <td>
          <button class="action-btn" onclick="removeCompetitor('${comp.id}')">Remove</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load competitors:', err);
  }
}

window.removeCompetitor = async function(competitorId) {
  if (!confirm('Remove this competitor from tracking?')) return;

  try {
    const response = await fetch('/api/admin/ops?resource=competitive-intelligence', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitorId }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    initializeCompetitiveIntelligenceDashboard();
  } catch (err) {
    console.error('Failed to remove competitor:', err);
    alert('Failed to remove competitor.');
  }
};

/* ============================================================ */
/* Price Comparison Chart */
/* ============================================================ */

function renderPriceComparison(container) {
  const section = document.createElement('div');
  section.className = 'ci-comparison-card';

  section.innerHTML = `
    <div class="section-head">
      <p class="eyebrow">Competition</p>
      <h2>Price Comparison</h2>
    </div>
    <div class="ci-chart-controls">
      <div class="btn-group">
        <button class="is-active" onclick="updateComparisonTimeframe(7)">7 Days</button>
        <button onclick="updateComparisonTimeframe(30)">30 Days</button>
        <button onclick="updateComparisonTimeframe(90)">90 Days</button>
      </div>
    </div>
    <div class="ci-comparison-chart" id="priceComparisonChart">
      <div class="ci-loading">Loading chart...</div>
    </div>
  `;

  container.appendChild(section);
  loadPriceComparisonChart();
}

window.updateComparisonTimeframe = function(days) {
  comparisonTimeframe = days;
  document.querySelectorAll('.ci-chart-controls .btn-group button').forEach((btn) => {
    btn.classList.remove('is-active');
  });
  event.target.classList.add('is-active');
  loadPriceComparisonChart();
};

async function loadPriceComparisonChart() {
  const chartEl = document.getElementById('priceComparisonChart');
  if (!chartEl || !dashboardData) return;

  try {
    // For now, render a simple bar chart with positioning data
    let html = '<div class="ci-bar-chart">';

    const { positioning } = dashboardData;
    if (positioning) {
      for (const [siteType, data] of Object.entries(positioning)) {
        if (!data) continue;

        const yourRate = data.yourAvgRate;
        const marketAvg = data.marketAverage;
        const maxRate = Math.max(yourRate, marketAvg) * 1.2;

        const yourHeight = (yourRate / maxRate) * 100;
        const marketHeight = (marketAvg / maxRate) * 100;

        html += `
          <div class="ci-bar-item">
            <div class="bar is-your-rate" style="height: ${yourHeight}%;"></div>
            <div class="label">Your ${siteType}</div>
            <div class="value">$${(yourRate / 100).toFixed(0)}</div>
          </div>
          <div class="ci-bar-item">
            <div class="bar" style="height: ${marketHeight}%;"></div>
            <div class="label">Market Avg</div>
            <div class="value">$${(marketAvg / 100).toFixed(0)}</div>
          </div>
        `;
      }
    }

    html += '</div>';
    chartEl.innerHTML = html;
  } catch (err) {
    console.error('Failed to load price comparison chart:', err);
    chartEl.innerHTML = '<div class="ci-empty-state">Failed to load chart</div>';
  }
}

/* ============================================================ */
/* Pricing Opportunities Section */
/* ============================================================ */

function renderPricingOpportunities(container) {
  const section = document.createElement('div');
  section.className = 'ci-opportunities-section';

  section.innerHTML = `
    <div class="section-head">
      <p class="eyebrow">Recommendations</p>
      <h2>Pricing Opportunities</h2>
    </div>
    <div class="ci-opportunities-grid" id="opportunitiesGrid">
      <div class="ci-empty-state">Loading opportunities...</div>
    </div>
  `;

  container.appendChild(section);
  loadOpportunities();
}

async function loadOpportunities() {
  const grid = document.getElementById('opportunitiesGrid');
  if (!grid) return;

  try {
    const response = await fetch('/api/admin/ops?resource=competitive-intelligence&action=opportunities');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const { opportunities } = data;
    if (!opportunities || opportunities.length === 0) {
      grid.innerHTML = '<div class="ci-empty-state">No pricing opportunities identified. Your rates are well-positioned.</div>';
      return;
    }

    grid.innerHTML = opportunities.slice(0, 6).map((opp) => {
      const isIncrease = opp.estimatedRevenueImpactMonth > 0;
      const badgeClass = isIncrease ? 'is-positive' : 'is-negative';

      return `
        <div class="ci-opportunity-card">
          <div class="site-name">${escapeHtml(opp.site.name)}</div>
          <div class="site-type">${opp.site.type}</div>
          <div class="rate-comparison">
            <div class="rate-item">
              <div class="label">Current</div>
              <div class="value">$${(opp.currentRate / 100).toFixed(2)}</div>
            </div>
            <div class="rate-item">
              <div class="label">Suggested</div>
              <div class="value">$${(opp.suggestedRateCents / 100).toFixed(2)}</div>
            </div>
          </div>
          <div class="suggestion">${opp.reason}</div>
          <span class="impact-badge ${badgeClass}">
            ${opp.percentChange > 0 ? '+' : ''}${opp.percentChange}%
          </span>
          <p style="font-size: 0.8rem; color: var(--cream-dim); margin-bottom: var(--sp-2);">
            Est. revenue impact: $${(opp.estimatedRevenueImpactMonth / 100).toFixed(0)}/month
          </p>
          <button class="apply-btn" onclick="applySuggestion('${opp.site.id}', ${opp.suggestedRateCents})">
            Apply Suggestion
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load opportunities:', err);
    grid.innerHTML = '<div class="ci-empty-state">Failed to load opportunities.</div>';
  }
}

window.applySuggestion = async function(siteId, suggestedRate) {
  console.log(`Applying suggestion: site ${siteId}, new rate $${suggestedRate / 100}`);
  alert('Feature coming soon: Rate updates will be applied through the pricing dashboard.');
};

/* ============================================================ */
/* Market Trends Chart */
/* ============================================================ */

function renderMarketTrends(container) {
  const section = document.createElement('div');
  section.className = 'ci-trends-section';

  section.innerHTML = `
    <div class="section-head">
      <p class="eyebrow">Analysis</p>
      <h2>Market Trends (90 Days)</h2>
    </div>
    <div class="ci-trends-chart" id="marketTrendsChart">
      <div class="ci-loading">Loading trends...</div>
    </div>
    <div class="ci-trend-legend">
      <div class="ci-trend-item">
        <div class="dot market"></div>
        <span>Market Average</span>
      </div>
      <div class="ci-trend-item">
        <div class="dot your-rate"></div>
        <span>Your Average</span>
      </div>
    </div>
  `;

  container.appendChild(section);
  loadTrendsChart();
}

async function loadTrendsChart() {
  const chartEl = document.getElementById('marketTrendsChart');
  if (!chartEl || !dashboardData) return;

  try {
    const { trends } = dashboardData;
    if (!trends || trends.length === 0) {
      chartEl.innerHTML = '<div class="ci-empty-state">No trend data available yet. Check back after collecting more market data.</div>';
      return;
    }

    // Render simple line chart representation
    const maxRate = Math.max(...trends.map((t) => t.marketAvgRate || 0));
    const minRate = Math.min(...trends.map((t) => t.marketAvgRate || 0).filter((r) => r > 0));

    let html = '<div class="ci-line-chart" style="position: relative; height: 100%;">';
    html += '<svg style="width: 100%; height: 100%;" viewBox="0 0 ' + (trends.length * 40) + ' 240" preserveAspectRatio="none">';

    // Draw grid
    html += '<defs><pattern id="gridPattern" width="40" height="30" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 30" fill="none" stroke="rgba(207,143,23,0.1)" stroke-width="0.5"/></pattern></defs>';
    html += '<rect width="' + (trends.length * 40) + '" height="240" fill="url(#gridPattern)"/>';

    // Draw line for market average
    const points = trends.map((t, i) => {
      const rate = t.marketAvgRate || 0;
      const y = 220 - ((rate - minRate) / (maxRate - minRate)) * 200;
      return (i * 40 + 20) + ',' + y;
    }).join(' ');

    html += '<polyline points="' + points + '" fill="none" stroke="url(#amberGradient)" stroke-width="2" vector-effect="non-scaling-stroke"/>';

    // Define gradients
    html += '<defs>';
    html += '<linearGradient id="amberGradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:var(--amber);stop-opacity:1" /><stop offset="100%" style="stop-color:var(--amber-light);stop-opacity:1" /></linearGradient>';
    html += '</defs>';

    html += '</svg></div>';

    chartEl.innerHTML = html;
  } catch (err) {
    console.error('Failed to load trends chart:', err);
    chartEl.innerHTML = '<div class="ci-empty-state">Failed to load trends.</div>';
  }
}

/* ============================================================ */
/* Error State */
/* ============================================================ */

function renderErrorState(container, message) {
  const section = document.createElement('div');
  section.className = 'ci-market-overview';
  section.innerHTML = `
    <div class="ci-empty-state">
      <p><strong>Error:</strong> ${escapeHtml(message)}</p>
      <button class="btn btn-ghost btn-sm" onclick="location.reload()">Reload Page</button>
    </div>
  `;
  container.appendChild(section);
}

/* ============================================================ */
/* Utility Functions */
/* ============================================================ */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export for use in park-dashboard.js
export { initializeCompetitiveIntelligenceDashboard };
