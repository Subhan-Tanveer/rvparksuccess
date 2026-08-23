// Pricing Intelligence Dashboard — manages dynamic pricing UI

import { confirmDialog, alertDialog, withLoading } from './ui-dialogs.js';
import { renderAiInsightWidget } from './ai-insight-widget.js';

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
    <p class="pricing-note" style="margin: -0.5rem 0 1rem; font-size: 0.875rem; color: var(--cream-dim, #999);">
      ${settings.dynamicPricingEnabled
        ? 'Every night, sites with enough booking history (3+ stays) get confidently-suggested rates applied automatically, within your Min/Max and steered by your Occupancy Target below. Lower-confidence suggestions are logged for you to review instead of applied automatically.'
        : 'Turn this on to have rates for the next 30 days adjust automatically overnight, within your Min/Max below. You can still calculate and apply suggestions manually either way.'}
    </p>

    <div class="pricing-cards">
      <div class="pricing-card">
        <div class="card-label">Min Rate <span class="info-icon" tabindex="0" role="img" aria-label="What this shows" title="A hard floor — the model will never suggest or auto-apply a nightly rate below this, no matter how low occupancy is.">?</span></div>
        <div class="card-value">${formatUsd(settings.minPriceCents)}</div>
        <input
          type="number"
          id="minPriceInput"
          min="1"
          step="0.01"
          value="${(settings.minPriceCents / 100).toFixed(2)}"
          placeholder="Min nightly rate ($)"
          class="pricing-input small"
        >
      </div>
      <div class="pricing-card">
        <div class="card-label">Max Rate <span class="info-icon" tabindex="0" role="img" aria-label="What this shows" title="A hard ceiling — the model will never suggest or auto-apply a nightly rate above this, no matter how high demand is.">?</span></div>
        <div class="card-value">${formatUsd(settings.maxPriceCents)}</div>
        <input
          type="number"
          id="maxPriceInput"
          min="1"
          step="0.01"
          value="${(settings.maxPriceCents / 100).toFixed(2)}"
          placeholder="Max nightly rate ($)"
          class="pricing-input small"
        >
      </div>
      <div class="pricing-card">
        <div class="card-label">Occupancy Target <span class="info-icon" tabindex="0" role="img" aria-label="What this shows" title="The occupancy percent the model treats as 'normal' for a given night. A night trending above this target gets pushed toward a higher rate; a night trending below it gets pushed toward a lower one — within your Min/Max above.">?</span></div>
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

      alertDialog({ title: 'Pricing Status Updated', message: data.park.dynamicPricingEnabled
          ? 'Dynamic pricing is now ENABLED. AI-suggested prices will be calculated for your dates.'
          : 'Dynamic pricing is now DISABLED. You are using manual pricing.' });
    }
  } catch (err) {
    console.error('Failed to toggle pricing:', err);
    alertDialog({ title: 'Error', message: 'Failed to update pricing status' });
  }
}

export async function savePricingSettings() {
  const minPriceInputValue = document.getElementById('minPriceInput')?.value;
  const maxPriceInputValue = document.getElementById('maxPriceInput')?.value;
  // Inputs are dollars (matching every other rate field in the dashboard); convert to cents for the API.
  const minPrice = minPriceInputValue ? Math.round(parseFloat(minPriceInputValue) * 100) : 2000;
  const maxPrice = maxPriceInputValue ? Math.round(parseFloat(maxPriceInputValue) * 100) : 50000;
  const occupancyTarget = parseInt(document.getElementById('occupancyTargetInput')?.value || 85);

  if (minPrice >= maxPrice) {
    alertDialog({ title: 'Invalid Settings', message: 'Min price must be less than max price' });
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
      alertDialog({ title: 'Saved', message: 'Pricing settings saved successfully' });
    } else {
      const err = await res.json();
      alertDialog({ title: 'Error', message: err.error || 'Failed to save settings' });
    }
  } catch (err) {
    console.error('Failed to save pricing settings:', err);
    alertDialog({ title: 'Error', message: 'Failed to save settings' });
  }
}

export async function calculateSuggestions() {
  const dateFrom = document.getElementById('pricingDateFrom')?.value;
  const dateTo = document.getElementById('pricingDateTo')?.value;

  if (!dateFrom || !dateTo) {
    alertDialog({ title: 'Missing Dates', message: 'Please select both start and end dates' });
    return;
  }

  if (new Date(dateTo) <= new Date(dateFrom)) {
    alertDialog({ title: 'Invalid Dates', message: 'End date must be after start date' });
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
        alertDialog({ title: 'Error', message: err.error || 'Failed to calculate prices' });
        return;
      }

      const data = await res.json();
      currentSuggestions = data.suggestions;
      renderSuggestions(data.suggestions, data.potentialImpact);
    } catch (err) {
      console.error('Failed to calculate suggestions:', err);
      alertDialog({ title: 'Error', message: 'Failed to calculate prices' });
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

  let html = '<div id="pricingAiInsightSlot"></div>';

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

  const insightSlot = document.getElementById('pricingAiInsightSlot');
  if (insightSlot) {
    const widget = renderAiInsightWidget('pricing-intelligence');
    widget.setBusy(() => {
      const dates = Object.keys(byDate).sort();
      let up = 0, down = 0, flat = 0, totalChangePercent = 0;
      for (const s of suggestions) {
        const change = s.suggestedRate - s.currentRate;
        if (change > 0) up++; else if (change < 0) down++; else flat++;
        totalChangePercent += s.currentRate > 0 ? ((change / s.currentRate) * 100) : 0;
      }
      return {
        dateRange: { start: dates[0], end: dates[dates.length - 1] },
        nightsConsidered: suggestions.length,
        nightsUp: up,
        nightsDown: down,
        nightsFlat: flat,
        averageChangePercent: suggestions.length ? Math.round((totalChangePercent / suggestions.length) * 10) / 10 : 0,
        // A sample, not the full set — the model needs representative
        // examples of the reasoning breakdown, not every line item.
        sampleSuggestions: suggestions.slice(0, 6).map((s) => ({
          date: s.date, site: s.siteName, occupancyPercent: s.occupancyPercent,
          changePercent: s.currentRate > 0 ? Math.round(((s.suggestedRate - s.currentRate) / s.currentRate) * 1000) / 10 : 0,
          reasoning: s.reasoning,
        })),
      };
    });
    insightSlot.appendChild(widget);
  }
}

export async function applySuggestion(siteId, date, suggestedRate, currentRate) {
  const confirmed = await confirmDialog({
    title: 'Apply Price',
    message: `Apply ${formatUsd(suggestedRate)} for ${new Date(date).toLocaleDateString()} (currently ${formatUsd(currentRate)})?`,
  });

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
        alertDialog({ title: 'Applied', message: 'Price applied successfully' });
      } else {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error || 'Failed to apply price' });
      }
    } catch (err) {
      console.error('Failed to apply price:', err);
      alertDialog({ title: 'Error', message: 'Failed to apply price' });
    }
  });
}

export async function applyAllSuggestions() {
  if (!currentSuggestions.length) {
    alertDialog({ title: 'Nothing to Do', message: 'No suggestions to apply' });
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Apply All Suggestions',
    message: `Apply ${currentSuggestions.length} price suggestions? This will update rates for the next 30 days.`,
  });

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

    alertDialog({ title: 'Batch Apply Complete', message: `Applied ${applied} price${applied !== 1 ? 's' : ''}${failed > 0 ? `. ${failed} failed.` : ''}` });

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
