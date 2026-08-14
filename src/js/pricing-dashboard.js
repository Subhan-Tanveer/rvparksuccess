// Pricing Intelligence Dashboard — manages dynamic pricing UI

import { confirmDialog, alertDialog, withLoading } from './ui-dialogs.js';

let currentPricingSettings = null;
let currentSuggestions = [];

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

// Initialize pricing dashboard (call from main dashboard after load)
export async function initPricingDashboard(park) {
  if (!park) return;

  // Fetch pricing settings
  try {
    const res = await fetch('/api/admin/features?resource=pricing');
    if (res.ok) {
      const data = await res.json();
      currentPricingSettings = data.settings;
      renderPricingSettings(data.settings, park);
    }
  } catch (err) {
    console.error('Failed to load pricing settings:', err);
  }
}

// Render pricing settings UI
function renderPricingSettings(settings, park) {
  const container = document.getElementById('pricingSettingsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="pricing-header">
      <h3>Pricing Intelligence</h3>
      <div class="pricing-toggle">
        <label class="toggle-switch">
          <input
            type="checkbox"
            id="dynamicPricingToggle"
            ${settings.dynamicPricingEnabled ? 'checked' : ''}
            onchange="window.pricingDashboard.toggleDynamicPricing()"
          >
          <span class="toggle-slider"></span>
          <span class="toggle-label">Dynamic Pricing ${settings.dynamicPricingEnabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>
    </div>

    <div class="pricing-cards">
      <div class="pricing-card">
        <div class="card-label">Min Rate</div>
        <div class="card-value">${formatUsd(settings.minPriceCents)}</div>
        <input
          type="number"
          id="minPriceInput"
          min="100"
          step="100"
          value="${settings.minPriceCents}"
          placeholder="Min price in cents"
          class="pricing-input small"
        >
      </div>
      <div class="pricing-card">
        <div class="card-label">Max Rate</div>
        <div class="card-value">${formatUsd(settings.maxPriceCents)}</div>
        <input
          type="number"
          id="maxPriceInput"
          min="1000"
          step="100"
          value="${settings.maxPriceCents}"
          placeholder="Max price in cents"
          class="pricing-input small"
        >
      </div>
      <div class="pricing-card">
        <div class="card-label">Occupancy Target</div>
        <div class="card-value">${formatPercent(settings.occupancyTargetPercent)}</div>
        <input
          type="number"
          id="occupancyTargetInput"
          min="0"
          max="100"
          step="5"
          value="${settings.occupancyTargetPercent}"
          placeholder="Target occupancy %"
          class="pricing-input small"
        >
      </div>
    </div>

    <button
      class="btn btn-primary"
      onclick="window.pricingDashboard.savePricingSettings()"
    >
      Save Settings
    </button>

    <div id="pricingCalculationSection" style="margin-top: 2rem; ${!settings.dynamicPricingEnabled ? 'display:none;' : ''}">
      <h4>Calculate Suggested Prices</h4>
      <div class="pricing-controls">
        <input
          type="date"
          id="pricingDateFrom"
          class="input"
        >
        <span>to</span>
        <input
          type="date"
          id="pricingDateTo"
          class="input"
        >
        <button
          class="btn btn-secondary"
          onclick="window.pricingDashboard.calculateSuggestions()"
        >
          Calculate Prices
        </button>
      </div>
      <div id="pricingSuggestionsContainer" style="margin-top: 1.5rem;"></div>
    </div>
  `;

  // Set default date range (next 30 days)
  const today = new Date();
  const thirtyDaysOut = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const dateFromEl = document.getElementById('pricingDateFrom');
  const dateToEl = document.getElementById('pricingDateTo');
  if (dateFromEl) dateFromEl.value = today.toISOString().split('T')[0];
  if (dateToEl) dateToEl.value = thirtyDaysOut.toISOString().split('T')[0];
}

export async function toggleDynamicPricing() {
  try {
    const res = await fetch('/api/admin/features?resource=pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleDynamicPricing' }),
    });

    if (res.ok) {
      const data = await res.json();
      currentPricingSettings.dynamicPricingEnabled = data.park.dynamicPricingEnabled;

      // Show/hide calculation section
      const section = document.getElementById('pricingCalculationSection');
      if (section) {
        section.style.display = data.park.dynamicPricingEnabled ? 'block' : 'none';
      }

      // Update toggle label
      const label = document.querySelector('.toggle-label');
      if (label) {
        label.textContent = `Dynamic Pricing ${data.park.dynamicPricingEnabled ? 'ON' : 'OFF'}`;
      }

      alertDialog(
        data.park.dynamicPricingEnabled
          ? 'Dynamic pricing is now ENABLED. AI-suggested prices will be calculated for your dates.'
          : 'Dynamic pricing is now DISABLED. You are using manual pricing.',
        'Pricing Status Updated'
      );
    }
  } catch (err) {
    console.error('Failed to toggle pricing:', err);
    alertDialog('Failed to update pricing status', 'Error');
  }
}

export async function savePricingSettings() {
  const minPrice = parseInt(document.getElementById('minPriceInput')?.value || 2000);
  const maxPrice = parseInt(document.getElementById('maxPriceInput')?.value || 50000);
  const occupancyTarget = parseInt(document.getElementById('occupancyTargetInput')?.value || 85);

  if (minPrice >= maxPrice) {
    alertDialog('Min price must be less than max price', 'Invalid Settings');
    return;
  }

  try {
    const res = await fetch('/api/admin/features?resource=pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateSettings',
        minPriceCents: minPrice,
        maxPriceCents: maxPrice,
        occupancyTargetPercent: occupancyTarget,
      }),
    });

    if (res.ok) {
      currentPricingSettings.minPriceCents = minPrice;
      currentPricingSettings.maxPriceCents = maxPrice;
      currentPricingSettings.occupancyTargetPercent = occupancyTarget;
      alertDialog('Pricing settings saved successfully', 'Saved');
    } else {
      const err = await res.json();
      alertDialog(err.error || 'Failed to save settings', 'Error');
    }
  } catch (err) {
    console.error('Failed to save pricing settings:', err);
    alertDialog('Failed to save settings', 'Error');
  }
}

export async function calculateSuggestions() {
  const dateFrom = document.getElementById('pricingDateFrom')?.value;
  const dateTo = document.getElementById('pricingDateTo')?.value;

  if (!dateFrom || !dateTo) {
    alertDialog('Please select both start and end dates', 'Missing Dates');
    return;
  }

  if (new Date(dateTo) <= new Date(dateFrom)) {
    alertDialog('End date must be after start date', 'Invalid Dates');
    return;
  }

  await withLoading(async () => {
    try {
      const res = await fetch('/api/admin/features?resource=pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'calculate',
          dateRange: { start: dateFrom, end: dateTo },
          includeRecommendations: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alertDialog(err.error || 'Failed to calculate prices', 'Error');
        return;
      }

      const data = await res.json();
      currentSuggestions = data.suggestions;
      renderSuggestions(data.suggestions, data.potentialImpact);
    } catch (err) {
      console.error('Failed to calculate suggestions:', err);
      alertDialog('Failed to calculate prices', 'Error');
    }
  });
}

function renderSuggestions(suggestions, potentialImpact) {
  const container = document.getElementById('pricingSuggestionsContainer');
  if (!container) return;

  // Group by date
  const byDate = {};
  for (const s of suggestions) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  let html = '';

  // Show revenue impact summary if available
  if (potentialImpact) {
    html += `
      <div class="impact-card ${potentialImpact.potentialRevenueCents > 0 ? 'positive' : 'negative'}">
        <div class="impact-label">Potential Revenue Impact</div>
        <div class="impact-value">${formatUsd(potentialImpact.potentialRevenueCents)}</div>
        <div class="impact-detail">${formatPercent(potentialImpact.percentageGain)} increase vs current rates</div>
      </div>
    `;
  }

  // Suggestions table
  html += `
    <table class="pricing-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Site</th>
          <th>Current Rate</th>
          <th>Suggested Rate</th>
          <th>Change</th>
          <th>Occupancy</th>
          <th>Confidence</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
  `;

  const sortedDates = Object.keys(byDate).sort();
  for (const date of sortedDates) {
    const daySuggestions = byDate[date];
    for (const suggestion of daySuggestions) {
      const change = suggestion.suggestedRate - suggestion.currentRate;
      const changePercent = suggestion.currentRate > 0
        ? Math.round((change / suggestion.currentRate) * 1000) / 10
        : 0;
      const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';

      html += `
        <tr>
          <td>${new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
          <td>${suggestion.siteName}</td>
          <td>${formatUsd(suggestion.currentRate)}</td>
          <td><strong>${formatUsd(suggestion.suggestedRate)}</strong></td>
          <td class="${changeClass}">${change >= 0 ? '+' : ''}${formatUsd(change)} (${changePercent >= 0 ? '+' : ''}${changePercent}%)</td>
          <td>${formatPercent(suggestion.occupancyPercent)}</td>
          <td>
            <span class="confidence-badge" title="Data confidence">
              ${suggestion.confidence}%
            </span>
          </td>
          <td>
            <button
              class="btn btn-mini btn-apply"
              onclick="window.pricingDashboard.applySuggestion('${suggestion.siteId}', '${suggestion.date}', ${suggestion.suggestedRate}, ${suggestion.currentRate})"
              title="Apply this suggested price"
            >
              Apply
            </button>
          </td>
        </tr>
      `;
    }
  }

  html += `
      </tbody>
    </table>

    <div class="pricing-actions">
      <button
        class="btn btn-primary"
        onclick="window.pricingDashboard.applyAllSuggestions()"
      >
        Apply All Suggestions
      </button>
    </div>
  `;

  container.innerHTML = html;
}

export async function applySuggestion(siteId, date, suggestedRate, currentRate) {
  const confirmed = await confirmDialog(
    `Apply ${formatUsd(suggestedRate)} for ${new Date(date).toLocaleDateString()} (currently ${formatUsd(currentRate)})?`,
    'Apply Price'
  );

  if (!confirmed) return;

  await withLoading(async () => {
    try {
      const res = await fetch('/api/admin/features?resource=pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'applyPrice',
          siteId,
          dateOfStay: date,
          previousRate: currentRate,
          appliedRateCents: suggestedRate,
        }),
      });

      if (res.ok) {
        // Re-calculate to show updates
        const dateFromEl = document.getElementById('pricingDateFrom');
        const dateToEl = document.getElementById('pricingDateTo');
        if (dateFromEl && dateToEl) {
          await calculateSuggestions();
        }
        alertDialog('Price applied successfully', 'Applied');
      } else {
        const err = await res.json();
        alertDialog(err.error || 'Failed to apply price', 'Error');
      }
    } catch (err) {
      console.error('Failed to apply price:', err);
      alertDialog('Failed to apply price', 'Error');
    }
  });
}

export async function applyAllSuggestions() {
  if (!currentSuggestions.length) {
    alertDialog('No suggestions to apply', 'Nothing to Do');
    return;
  }

  const confirmed = await confirmDialog(
    `Apply ${currentSuggestions.length} price suggestions? This will update rates for the next 30 days.`,
    'Apply All Suggestions'
  );

  if (!confirmed) return;

  let applied = 0;
  let failed = 0;

  await withLoading(async () => {
    for (const suggestion of currentSuggestions) {
      try {
        const res = await fetch('/api/admin/features?resource=pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'applyPrice',
            siteId: suggestion.siteId,
            dateOfStay: suggestion.date,
            previousRate: suggestion.currentRate,
            appliedRateCents: suggestion.suggestedRate,
          }),
        });

        if (res.ok) {
          applied++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      }
    }

    alertDialog(
      `Applied ${applied} price${applied !== 1 ? 's' : ''}${failed > 0 ? `. ${failed} failed.` : ''}`,
      'Batch Apply Complete'
    );

    // Re-calculate to show updates
    const dateFromEl = document.getElementById('pricingDateFrom');
    const dateToEl = document.getElementById('pricingDateTo');
    if (dateFromEl && dateToEl) {
      await calculateSuggestions();
    }
  });
}

// Export functions to window for HTML access
if (typeof window !== 'undefined') {
  window.pricingDashboard = {
    toggleDynamicPricing,
    savePricingSettings,
    calculateSuggestions,
    applySuggestion,
    applyAllSuggestions,
  };
}
