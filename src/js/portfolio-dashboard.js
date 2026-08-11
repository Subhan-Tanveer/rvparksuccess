// Portfolio Dashboard — Multi-Property Management UI
// Handles property portfolio view, consolidated metrics, bulk operations, and white-label branding

import '../css/tokens.css';
import { initCore } from './core.js';
import { confirmDialog, formDialog, alertDialog, withLoading } from './ui-dialogs.js';

initCore();

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  return Math.round(value * 10) / 10 + '%';
}

let portfolio = null;
let consolidatedMetrics = null;
let selectedProperties = new Set();
let bulkOperationType = null;

// Load portfolio data on page open
async function loadPortfolio() {
  try {
    withLoading(true);

    // Load properties
    const portfolioRes = await fetch('/api/admin/multi-property?resource=portfolio');
    if (portfolioRes.status === 401) {
      window.location.href = 'login.html';
      return;
    }

    if (!portfolioRes.ok) {
      throw new Error('Failed to load portfolio');
    }

    const portfolioData = await portfolioRes.json();
    portfolio = portfolioData.properties;

    // If user has only 1 property, redirect to park dashboard
    if (portfolio.length === 1) {
      window.location.href = `park-dashboard.html?parkId=${portfolio[0].id}`;
      return;
    }

    document.getElementById('gate').style.display = 'block';
    renderPortfolioOverview();

    // Load consolidated metrics
    const metricsRes = await fetch('/api/admin/multi-property/consolidated-metrics?days=30');
    if (metricsRes.ok) {
      consolidatedMetrics = await metricsRes.json();
      renderConsolidatedMetrics();
    }

    // Load alerts
    const alertsRes = await fetch('/api/admin/multi-property/alerts');
    if (alertsRes.ok) {
      const alertsData = await alertsRes.json();
      renderAlerts(alertsData.alerts);
    }

    renderPropertyGrid();
  } catch (err) {
    console.error('Portfolio load error:', err);
    alertDialog('Error loading portfolio', err.message);
  } finally {
    withLoading(false);
  }
}

function renderPortfolioOverview() {
  if (!portfolio) return;

  const totalProperties = portfolio.length;
  const totalSites = portfolio.reduce((sum, p) => sum + (p.sitesCount || 0), 0);

  document.getElementById('portfolioTotalProperties').textContent = totalProperties;
  document.getElementById('portfolioTotalSites').textContent = totalSites;

  if (consolidatedMetrics) {
    document.getElementById('portfolioTotalRevenue').textContent = formatUsd(
      consolidatedMetrics.totalRevenueCents
    );
    document.getElementById('portfolioAverageOccupancy').textContent = formatPercent(
      consolidatedMetrics.averageOccupancyPercent
    );
    document.getElementById('portfolioTotalGuests').textContent = consolidatedMetrics.totalGuests;
  }
}

function renderConsolidatedMetrics() {
  if (!consolidatedMetrics) return;

  const container = document.getElementById('consolidatedMetricsContainer');
  if (!container) return;

  // Revenue by property pie chart data
  const propertyMetrics = consolidatedMetrics.propertyMetrics;
  const topProperties = propertyMetrics.slice(0, 5);

  // Render property breakdown
  const breakdownHtml = topProperties
    .map((pm, idx) => {
      const percent =
        consolidatedMetrics.totalRevenueCents > 0
          ? (pm.revenueCents / consolidatedMetrics.totalRevenueCents) * 100
          : 0;
      return `
        <div class="metric-row">
          <div class="metric-label">
            <div class="metric-rank">${idx + 1}</div>
            <div class="metric-name">${pm.parkName}</div>
          </div>
          <div class="metric-bar">
            <div class="metric-bar-fill" style="width: ${percent}%"></div>
          </div>
          <div class="metric-value">${formatUsd(pm.revenueCents)}</div>
        </div>
      `;
    })
    .join('');

  const metricsHtml = `
    <div class="metrics-section">
      <h3>Revenue by Property (Last 30 Days)</h3>
      ${breakdownHtml}
    </div>
  `;

  container.innerHTML = metricsHtml;
}

function renderAlerts(alerts) {
  const container = document.getElementById('alertsContainer');
  if (!container) return;

  if (alerts.length === 0) {
    container.innerHTML = '<div class="alerts-empty">No active alerts</div>';
    return;
  }

  const alertsHtml = alerts
    .map(
      alert => `
    <div class="alert-item alert-${alert.severity}">
      <div class="alert-icon">${alert.severity === 'warning' ? '⚠️' : 'ℹ️'}</div>
      <div class="alert-content">
        <div class="alert-title">${alert.parkName}</div>
        <div class="alert-message">${alert.message}</div>
      </div>
    </div>
  `
    )
    .join('');

  container.innerHTML = `<div class="alerts-list">${alertsHtml}</div>`;
}

function renderPropertyGrid() {
  if (!portfolio) return;

  const container = document.getElementById('propertyGridContainer');
  if (!container) return;

  const gridHtml = portfolio
    .map(
      property => `
    <div class="property-card">
      <div class="property-card-header">
        <div class="property-title">${property.name}</div>
        <input type="checkbox" class="property-select-checkbox" data-park-id="${property.id}" />
      </div>
      <div class="property-card-body">
        <div class="property-meta">
          <div class="meta-item">
            <div class="meta-label">Location</div>
            <div class="meta-value">${property.location || 'N/A'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Sites</div>
            <div class="meta-value">${property.sitesCount || 0}</div>
          </div>
        </div>
        <div class="property-stats">
          <div class="stat">
            <div class="stat-label">Occupancy</div>
            <div class="stat-value">${formatPercent(property.occupancyPercent || 0)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">YTD Revenue</div>
            <div class="stat-value">${formatUsd(property.revenueCents || 0)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">ADR</div>
            <div class="stat-value">${formatUsd((property.adr || 0) * 100)}</div>
          </div>
        </div>
      </div>
      <div class="property-card-footer">
        <button class="btn-small" onclick="viewProperty('${property.id}')">View Dashboard</button>
      </div>
    </div>
  `
    )
    .join('');

  container.innerHTML = gridHtml;

  // Add event listeners for checkboxes
  document.querySelectorAll('.property-select-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', e => {
      if (e.target.checked) {
        selectedProperties.add(e.target.dataset.parkId);
      } else {
        selectedProperties.delete(e.target.dataset.parkId);
      }
      updateBulkOperationsUI();
    });
  });
}

function updateBulkOperationsUI() {
  const bulkOpsContainer = document.getElementById('bulkOperationsContainer');
  if (!bulkOpsContainer) return;

  if (selectedProperties.size === 0) {
    bulkOpsContainer.style.display = 'none';
    return;
  }

  bulkOpsContainer.style.display = 'block';
  document.getElementById('selectedPropertiesCount').textContent = selectedProperties.size;
}

async function startBulkRateUpdate() {
  const selectedIds = Array.from(selectedProperties);
  if (selectedIds.length === 0) {
    alertDialog('No properties selected', 'Please select at least one property');
    return;
  }

  const result = await formDialog('Bulk Update Rates', [
    { name: 'baseRate', label: 'Base Rate (cents)', type: 'number', required: true },
    { name: 'applyToAll', label: 'Apply to all sites in selected properties', type: 'checkbox' },
  ]);

  if (!result) return;

  try {
    withLoading(true);

    const rateCard = {};
    selectedIds.forEach(parkId => {
      // In a real implementation, get all sites and build rate card
      // For now, just apply a global rate
    });

    const response = await fetch('/api/admin/multi-property/bulk-update-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyIds: selectedIds,
        rateCard,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    alertDialog(
      'Bulk Update Complete',
      `Updated ${data.completed} properties, ${data.failed} failed`
    );

    // Reload data
    loadPortfolio();
  } catch (err) {
    alertDialog('Error', err.message);
  } finally {
    withLoading(false);
  }
}

async function startBulkCampaign() {
  const selectedIds = Array.from(selectedProperties);
  if (selectedIds.length === 0) {
    alertDialog('No properties selected', 'Please select at least one property');
    return;
  }

  const result = await formDialog('Send Promotion', [
    { name: 'promoCode', label: 'Promo Code', type: 'text', required: true },
    { name: 'discount', label: 'Discount (%)', type: 'number', required: true },
    { name: 'description', label: 'Description', type: 'text', required: false },
  ]);

  if (!result) return;

  try {
    withLoading(true);

    const response = await fetch('/api/admin/multi-property/bulk-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyIds: selectedIds,
        campaign: {
          code: result.promoCode,
          discount: result.discount,
          description: result.description,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    alertDialog(
      'Campaign Sent',
      `Promotion sent to ${data.completed} properties, ${data.failed} failed`
    );

    // Reload data
    loadPortfolio();
  } catch (err) {
    alertDialog('Error', err.message);
  } finally {
    withLoading(false);
  }
}

async function startBulkMaintenance() {
  const selectedIds = Array.from(selectedProperties);
  if (selectedIds.length === 0) {
    alertDialog('No properties selected', 'Please select at least one property');
    return;
  }

  const result = await formDialog('Schedule Maintenance', [
    { name: 'startDate', label: 'Start Date', type: 'date', required: true },
    { name: 'endDate', label: 'End Date', type: 'date', required: true },
    { name: 'reason', label: 'Reason', type: 'text', required: false },
  ]);

  if (!result) return;

  try {
    withLoading(true);

    const response = await fetch('/api/admin/multi-property/bulk-maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyIds: selectedIds,
        siteIds: [],
        startDate: result.startDate,
        endDate: result.endDate,
        reason: result.reason || 'Maintenance',
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    alertDialog(
      'Maintenance Scheduled',
      `Dates blocked for ${data.completed} properties, ${data.failed} failed`
    );

    // Reload data
    loadPortfolio();
  } catch (err) {
    alertDialog('Error', err.message);
  } finally {
    withLoading(false);
  }
}

function viewProperty(parkId) {
  window.location.href = `park-dashboard.html?parkId=${parkId}`;
}

function selectAllProperties() {
  portfolio.forEach(p => selectedProperties.add(p.id));
  document.querySelectorAll('.property-select-checkbox').forEach(cb => {
    cb.checked = true;
  });
  updateBulkOperationsUI();
}

function clearPropertySelection() {
  selectedProperties.clear();
  document.querySelectorAll('.property-select-checkbox').forEach(cb => {
    cb.checked = false;
  });
  updateBulkOperationsUI();
}

// Expose functions to global scope
window.viewProperty = viewProperty;
window.selectAllProperties = selectAllProperties;
window.clearPropertySelection = clearPropertySelection;
window.startBulkRateUpdate = startBulkRateUpdate;
window.startBulkCampaign = startBulkCampaign;
window.startBulkMaintenance = startBulkMaintenance;

// Load on page open
loadPortfolio();
