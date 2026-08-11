/**
 * Booking Rules Dashboard
 * UI for managing booking rules, validation testing, and impact analysis
 */

import { confirmDialog, formDialog, alertDialog, withLoading } from './ui-dialogs.js';

export function initBookingRulesDashboard() {
  const container = document.getElementById('bookingRulesDashboard');
  if (!container) return;

  let currentParkId = null;
  let currentSiteId = null;
  let rules = [];
  let sites = [];

  container.innerHTML = `
    <div class="booking-rules-section">
      <div class="section-head" style="margin-bottom: var(--sp-3);">
        <p class="eyebrow">Booking Control</p>
        <h2 style="font-size: 1.375rem;">Booking Rules</h2>
      </div>

      <!-- Site Selector -->
      <div style="margin-bottom: var(--sp-4);">
        <label style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim); display: block; margin-bottom: 6px;">Select Site</label>
        <select id="siteSelect" style="width: 100%; padding: var(--sp-2); border-radius: var(--radius-md); border: 1px solid var(--border-glass); background: var(--surface-glass); color: var(--cream); font-size: 0.9375rem;">
          <option value="">All Sites</option>
        </select>
      </div>

      <!-- Rule Type Filter -->
      <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); flex-wrap: wrap;">
        <button class="rule-filter-btn is-active" data-filter="">All</button>
        <button class="rule-filter-btn" data-filter="min_stay">Min Stay</button>
        <button class="rule-filter-btn" data-filter="max_stay">Max Stay</button>
        <button class="rule-filter-btn" data-filter="booking_window">Booking Window</button>
        <button class="rule-filter-btn" data-filter="group_size">Group Size</button>
        <button class="rule-filter-btn" data-filter="blackout">Blackout Dates</button>
        <button class="rule-filter-btn" data-filter="cancellation">Cancellation</button>
        <button class="rule-filter-btn" data-filter="seasonal">Seasonal</button>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); flex-wrap: wrap;">
        <button id="createRuleBtn" class="btn btn-primary btn-sm">+ New Rule</button>
        <button id="validateBookingBtn" class="btn btn-secondary btn-sm">Test Booking</button>
        <button id="blackoutDatesBtn" class="btn btn-secondary btn-sm">Blackout Dates</button>
      </div>

      <!-- Rules Table -->
      <div class="rules-table-container">
        <table class="rules-table">
          <thead>
            <tr>
              <th>Rule Name</th>
              <th>Type</th>
              <th>Site</th>
              <th>Config</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="rulesTableBody">
            <tr><td colspan="6" style="text-align: center; padding: var(--sp-4); color: var(--cream-dim);">No rules yet</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Alert Box -->
      <div id="rulesAlert" class="admin-alert" style="margin-top: var(--sp-4);"></div>
    </div>
  `;

  // Initialize
  setupEventListeners();
  loadData();

  function setupEventListeners() {
    document.getElementById('createRuleBtn').addEventListener('click', openRuleEditor);
    document.getElementById('validateBookingBtn').addEventListener('click', openValidationTester);
    document.getElementById('blackoutDatesBtn').addEventListener('click', openBlackoutManager);
    document.getElementById('siteSelect').addEventListener('change', (e) => {
      currentSiteId = e.target.value || null;
      renderRules();
    });

    // Rule type filters
    document.querySelectorAll('.rule-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.rule-filter-btn').forEach((b) => b.classList.remove('is-active'));
        e.target.classList.add('is-active');
        renderRules();
      });
    });
  }

  async function loadData() {
    try {
      const dashRes = await fetch('/api/admin/dashboard');
      const dash = await dashRes.json();
      currentParkId = dash.parkId;

      sites = dash.sites || [];
      const siteSelect = document.getElementById('siteSelect');
      sites.forEach((site) => {
        const opt = document.createElement('option');
        opt.value = site.id;
        opt.textContent = site.name;
        siteSelect.appendChild(opt);
      });

      await refreshRules();
    } catch (err) {
      console.error('Dashboard load error:', err);
      showAlert('Error loading dashboard', 'error');
    }
  }

  async function refreshRules() {
    try {
      const url = `/api/admin/booking-rules?parkId=${currentParkId}`;
      const res = await fetch(url);
      rules = await res.json();
      renderRules();
    } catch (err) {
      console.error('Rules load error:', err);
      showAlert('Error loading rules', 'error');
    }
  }

  function renderRules() {
    const tbody = document.getElementById('rulesTableBody');
    const filterBtn = document.querySelector('.rule-filter-btn.is-active');
    const filterType = filterBtn?.dataset.filter || '';

    let filtered = rules;
    if (currentSiteId) {
      filtered = filtered.filter((r) => !r.site_id || r.site_id === currentSiteId);
    }
    if (filterType) {
      filtered = filtered.filter((r) => r.rule_type === filterType);
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: var(--sp-4); color: var(--cream-dim);">No rules match</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((rule) => {
        const site = sites.find((s) => s.id === rule.site_id);
        const config = JSON.parse(rule.rule_config_json);
        return `
          <tr>
            <td><strong>${getRuleName(rule.rule_type, config)}</strong></td>
            <td><span class="rule-type-badge">${rule.rule_type.replace(/_/g, ' ')}</span></td>
            <td>${site ? site.name : 'Park-wide'}</td>
            <td><code>${getConfigSummary(rule.rule_type, config)}</code></td>
            <td>
              <span class="status-chip ${rule.is_active ? 'is-confirmed' : 'is-pending'}">
                ${rule.is_active ? 'active' : 'inactive'}
              </span>
            </td>
            <td style="font-size: 0.875rem;">
              <button class="rule-action-btn" onclick="editRule('${rule.id}')">Edit</button>
              <button class="rule-action-btn" onclick="deleteRule('${rule.id}')">Delete</button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function getRuleName(type, config) {
    const names = {
      min_stay: `Min ${config.nights} nights`,
      max_stay: `Max ${config.nights} nights`,
      booking_window: `Book up to ${config.days_in_advance} days ahead`,
      group_size: `Groups ${config.min_people || 1}-${config.max_people || '∞'}`,
      blackout: `Blackout: ${config.reason}`,
      cancellation: `Cancellation Policy`,
      seasonal: `${config.season} Rules`,
    };
    return names[type] || type;
  }

  function getConfigSummary(type, config) {
    const summaries = {
      min_stay: `${config.nights} nights min`,
      max_stay: `${config.nights} nights max`,
      booking_window: `${config.days_in_advance}d advance`,
      group_size: `${config.min_people}-${config.max_people} people`,
      cancellation: `${config.tiers?.length || 0} refund tiers`,
      seasonal: `${config.season} season`,
    };
    return summaries[type] || JSON.stringify(config).substring(0, 50);
  }

  async function openRuleEditor(ruleId = null) {
    const rule = ruleId ? rules.find((r) => r.id === ruleId) : null;
    const config = rule ? JSON.parse(rule.rule_config_json) : {};

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2>${ruleId ? 'Edit Rule' : 'Create New Rule'}</h2>
          <button class="modal-close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Rule Type *</label>
            <select id="ruleTypeSelect" ${ruleId ? 'disabled' : ''} style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);">
              <option value="">-- Select --</option>
              <option value="min_stay" ${config.nights !== undefined && rule?.rule_type === 'min_stay' ? 'selected' : ''}>Minimum Stay</option>
              <option value="max_stay" ${config.nights !== undefined && rule?.rule_type === 'max_stay' ? 'selected' : ''}>Maximum Stay</option>
              <option value="booking_window" ${rule?.rule_type === 'booking_window' ? 'selected' : ''}>Booking Window</option>
              <option value="group_size" ${rule?.rule_type === 'group_size' ? 'selected' : ''}>Group Size Limit</option>
              <option value="cancellation" ${rule?.rule_type === 'cancellation' ? 'selected' : ''}>Cancellation Policy</option>
              <option value="seasonal" ${rule?.rule_type === 'seasonal' ? 'selected' : ''}>Seasonal Rules</option>
            </select>
          </div>

          <div class="form-group">
            <label>Apply to Site</label>
            <select id="ruleSiteSelect" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);">
              <option value="">Park-wide (all sites)</option>
              ${sites.map((s) => `<option value="${s.id}" ${rule?.site_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>

          <div id="ruleConfigArea"></div>

          <div class="form-group">
            <label>
              <input type="checkbox" id="ruleActiveCheck" ${rule?.is_active !== false ? 'checked' : ''} />
              Active
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-dialog').remove()">Cancel</button>
          <button class="btn btn-primary" id="saveRuleBtn">Save Rule</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector('.modal-close');
    const overlay = dialog.querySelector('.modal-overlay');
    closeBtn.addEventListener('click', () => dialog.remove());
    overlay.addEventListener('click', () => dialog.remove());

    const typeSelect = dialog.querySelector('#ruleTypeSelect');
    typeSelect.addEventListener('change', () => renderRuleConfig(typeSelect.value, config, dialog));

    if (rule) {
      typeSelect.value = rule.rule_type;
      renderRuleConfig(rule.rule_type, config, dialog);
    }

    dialog.querySelector('#saveRuleBtn').addEventListener('click', async () => {
      await saveRule(ruleId, dialog);
      dialog.remove();
    });
  }

  function renderRuleConfig(ruleType, config, dialog) {
    const area = dialog.querySelector('#ruleConfigArea');

    const configs = {
      min_stay: `
        <div class="form-group">
          <label>Minimum Nights</label>
          <input type="number" id="configMinNights" value="${config.nights || 1}" min="1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
      `,
      max_stay: `
        <div class="form-group">
          <label>Maximum Nights</label>
          <input type="number" id="configMaxNights" value="${config.nights || 30}" min="1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
      `,
      booking_window: `
        <div class="form-group">
          <label>Days in Advance</label>
          <input type="number" id="configDaysAdvance" value="${config.days_in_advance || 180}" min="1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
        <div class="form-group">
          <label>Minimum Days Before Checkin</label>
          <input type="number" id="configMinDaysBefore" value="${config.min_days_before || 0}" min="0" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
      `,
      group_size: `
        <div class="form-group">
          <label>Minimum People</label>
          <input type="number" id="configMinPeople" value="${config.min_people || 1}" min="1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
        <div class="form-group">
          <label>Maximum People</label>
          <input type="number" id="configMaxPeople" value="${config.max_people || 8}" min="1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
      `,
      cancellation: `
        <div class="form-group">
          <label>Refund Tiers (JSON)</label>
          <textarea id="configCancelTiers" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream); font-family: monospace; font-size: 0.8125rem; height: 150px;">${JSON.stringify(config.tiers || [{ days_before_checkin: 14, refund_percent: 100 }, { days_before_checkin: 7, refund_percent: 50 }, { days_before_checkin: 0, refund_percent: 0 }], null, 2)}</textarea>
          <small style="color: var(--cream-dim);">Format: [{days_before_checkin: 14, refund_percent: 100}, ...]</small>
        </div>
      `,
      seasonal: `
        <div class="form-group">
          <label>Season</label>
          <select id="configSeason" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);">
            <option value="spring" ${config.season === 'spring' ? 'selected' : ''}>Spring (Mar-May)</option>
            <option value="summer" ${config.season === 'summer' ? 'selected' : ''}>Summer (Jun-Aug)</option>
            <option value="fall" ${config.season === 'fall' ? 'selected' : ''}>Fall (Sep-Nov)</option>
            <option value="winter" ${config.season === 'winter' ? 'selected' : ''}>Winter (Dec-Feb)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Price Multiplier</label>
          <input type="number" id="configSeasonMultiplier" value="${config.multiplier || 1.0}" min="0.1" step="0.1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="configWeekendsOnly" ${config.weekends_only ? 'checked' : ''} /> Weekends only</label>
        </div>
      `,
    };

    area.innerHTML = configs[ruleType] || '<p style="color: var(--cream-dim);">Select a rule type</p>';
  }

  async function saveRule(ruleId, dialog) {
    try {
      const typeSelect = dialog.querySelector('#ruleTypeSelect');
      const siteSelect = dialog.querySelector('#ruleSiteSelect');
      const activeCheck = dialog.querySelector('#ruleActiveCheck');

      const ruleType = typeSelect.value;
      if (!ruleType) {
        showAlert('Please select a rule type', 'error');
        return;
      }

      // Build config based on type
      let ruleConfig = {};
      if (ruleType === 'min_stay' || ruleType === 'max_stay') {
        ruleConfig.nights = parseInt(
          dialog.querySelector('#configMinNights')?.value ||
          dialog.querySelector('#configMaxNights')?.value || 1
        );
      } else if (ruleType === 'booking_window') {
        ruleConfig.days_in_advance = parseInt(
          dialog.querySelector('#configDaysAdvance')?.value || 180
        );
        ruleConfig.min_days_before = parseInt(
          dialog.querySelector('#configMinDaysBefore')?.value || 0
        );
      } else if (ruleType === 'group_size') {
        ruleConfig.min_people = parseInt(
          dialog.querySelector('#configMinPeople')?.value || 1
        );
        ruleConfig.max_people = parseInt(
          dialog.querySelector('#configMaxPeople')?.value || 8
        );
      } else if (ruleType === 'cancellation') {
        ruleConfig.tiers = JSON.parse(
          dialog.querySelector('#configCancelTiers')?.value || '[]'
        );
      } else if (ruleType === 'seasonal') {
        ruleConfig.season = dialog.querySelector('#configSeason')?.value || 'spring';
        ruleConfig.multiplier = parseFloat(
          dialog.querySelector('#configSeasonMultiplier')?.value || 1.0
        );
        ruleConfig.weekends_only = dialog.querySelector('#configWeekendsOnly')?.checked || false;
      }

      const url = ruleId ? `/api/admin/booking-rules/${ruleId}` : '/api/admin/booking-rules';
      const method = ruleId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parkId: currentParkId,
          siteId: siteSelect.value || null,
          ruleType,
          ruleConfig,
          isActive: activeCheck.checked,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        showAlert(err.error || 'Error saving rule', 'error');
        return;
      }

      showAlert(
        `Rule ${ruleId ? 'updated' : 'created'} successfully`,
        'success'
      );
      await refreshRules();
    } catch (err) {
      console.error('Save rule error:', err);
      showAlert('Error saving rule', 'error');
    }
  }

  async function openValidationTester() {
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Test Booking Validation</h2>
          <button class="modal-close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Site</label>
            <select id="testSiteSelect" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);">
              ${sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Check-in Date</label>
            <input type="date" id="testCheckIn" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
          </div>
          <div class="form-group">
            <label>Check-out Date</label>
            <input type="date" id="testCheckOut" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
          </div>
          <div class="form-group">
            <label>Guest Count</label>
            <input type="number" id="testGuestCount" value="1" min="1" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
          </div>

          <div id="validationResult" style="margin-top: var(--sp-4); padding: var(--sp-3); border-radius: var(--radius-md); background: var(--surface-glass); border: 1px solid var(--border-glass); display: none;">
            <p id="validationAllowed" style="font-weight: 600; margin-bottom: var(--sp-2);"></p>
            <div id="validationReasons" style="font-size: 0.875rem; color: #f0a89a;"></div>
            <div id="validationWarnings" style="font-size: 0.875rem; color: #e0a86a; margin-top: var(--sp-2);"></div>
            <div id="validationCost" style="font-size: 0.875rem; color: var(--amber-light); margin-top: var(--sp-2);"></div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-dialog').remove()">Close</button>
          <button class="btn btn-primary" id="testValidateBtn">Test Validation</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector('.modal-close');
    const overlay = dialog.querySelector('.modal-overlay');
    closeBtn.addEventListener('click', () => dialog.remove());
    overlay.addEventListener('click', () => dialog.remove());

    dialog.querySelector('#testValidateBtn').addEventListener('click', async () => {
      const siteId = dialog.querySelector('#testSiteSelect').value;
      const checkIn = dialog.querySelector('#testCheckIn').value;
      const checkOut = dialog.querySelector('#testCheckOut').value;
      const guestCount = parseInt(dialog.querySelector('#testGuestCount').value);

      if (!siteId || !checkIn || !checkOut) {
        showAlert('Please fill in all fields', 'error');
        return;
      }

      try {
        const res = await fetch('/api/admin/booking-rules/validate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            parkId: currentParkId,
            siteId,
            checkIn,
            checkOut,
            guestCount,
          }),
        });

        const result = await res.json();
        const resultDiv = dialog.querySelector('#validationResult');
        resultDiv.style.display = 'block';

        dialog.querySelector('#validationAllowed').textContent = result.allowed
          ? '✓ Booking Allowed'
          : '✗ Booking Blocked';
        dialog.querySelector('#validationAllowed').style.color = result.allowed
          ? 'var(--amber-light)'
          : '#f0a89a';

        if (result.reasons.length > 0) {
          dialog.querySelector('#validationReasons').innerHTML = `
            <strong>Blocking Reasons:</strong><ul style="margin: 6px 0 0 20px;">
              ${result.reasons.map((r) => `<li>${r}</li>`).join('')}
            </ul>
          `;
        } else {
          dialog.querySelector('#validationReasons').innerHTML = '';
        }

        if (result.warnings.length > 0) {
          dialog.querySelector('#validationWarnings').innerHTML = `
            <strong>Warnings:</strong><ul style="margin: 6px 0 0 20px;">
              ${result.warnings.map((w) => `<li>${w}</li>`).join('')}
            </ul>
          `;
        } else {
          dialog.querySelector('#validationWarnings').innerHTML = '';
        }

        if (result.cost) {
          const totalCost = (result.cost.total_cost / 100).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
          });
          dialog.querySelector('#validationCost').innerHTML = `<strong>Estimated Cost:</strong> ${totalCost}`;
        }
      } catch (err) {
        console.error('Validation test error:', err);
        showAlert('Error running validation', 'error');
      }
    });
  }

  async function openBlackoutManager() {
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
        <div class="modal-header">
          <h2>Blackout Dates</h2>
          <button class="modal-close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Site</label>
            <select id="blackoutSiteSelect" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);">
              ${sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Start Date</label>
            <input type="date" id="blackoutStart" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input type="date" id="blackoutEnd" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
          </div>
          <div class="form-group">
            <label>Reason</label>
            <input type="text" id="blackoutReason" placeholder="e.g., Maintenance, Private Event" style="width: 100%; padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: var(--surface-glass); color: var(--cream);" />
          </div>

          <button class="btn btn-primary" style="width: 100%; margin-bottom: var(--sp-4);" id="addBlackoutBtn">+ Add Blackout</button>

          <div id="blackoutList" style="border-top: 1px solid var(--border-glass); padding-top: var(--sp-3);"></div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-dialog').remove()">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector('.modal-close');
    const overlay = dialog.querySelector('.modal-overlay');
    closeBtn.addEventListener('click', () => dialog.remove());
    overlay.addEventListener('click', () => dialog.remove());

    dialog.querySelector('#addBlackoutBtn').addEventListener('click', async () => {
      const siteId = dialog.querySelector('#blackoutSiteSelect').value;
      const startDate = dialog.querySelector('#blackoutStart').value;
      const endDate = dialog.querySelector('#blackoutEnd').value;
      const reason = dialog.querySelector('#blackoutReason').value;

      if (!siteId || !startDate || !endDate) {
        showAlert('Please fill in all required fields', 'error');
        return;
      }

      try {
        const res = await fetch('/api/admin/booking-rules/blackout-dates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            parkId: currentParkId,
            siteId,
            startDate,
            endDate,
            reason,
          }),
        });

        if (!res.ok) throw new Error('Failed to create blackout');

        showAlert('Blackout period created', 'success');
        dialog.querySelector('#blackoutStart').value = '';
        dialog.querySelector('#blackoutEnd').value = '';
        dialog.querySelector('#blackoutReason').value = '';

        await loadBlackouts(dialog);
      } catch (err) {
        console.error('Error adding blackout:', err);
        showAlert('Error creating blackout', 'error');
      }
    });

    await loadBlackouts(dialog);
  }

  async function loadBlackouts(dialog) {
    try {
      const siteId = dialog.querySelector('#blackoutSiteSelect').value;
      const res = await fetch(
        `/api/admin/booking-rules/blackout-dates?parkId=${currentParkId}&siteId=${siteId}`
      );
      const blackouts = await res.json();

      const listDiv = dialog.querySelector('#blackoutList');
      if (blackouts.length === 0) {
        listDiv.innerHTML = '<p style="color: var(--cream-dim); text-align: center;">No blackout dates</p>';
        return;
      }

      listDiv.innerHTML = blackouts
        .map(
          (b) => `
        <div style="padding: var(--sp-2); background: rgba(217,60,46,0.1); border-radius: var(--radius-md); margin-bottom: var(--sp-2); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${b.start_date} to ${b.end_date}</strong><br>
            <small style="color: var(--cream-dim);">${b.reason || 'No reason'}</small>
          </div>
          <button class="rule-action-btn" onclick="deleteBlackout('${b.id}')">Delete</button>
        </div>
      `
        )
        .join('');
    } catch (err) {
      console.error('Load blackouts error:', err);
    }
  }

  function showAlert(message, type) {
    const alert = document.getElementById('rulesAlert');
    alert.textContent = message;
    alert.className = `admin-alert is-visible is-${type}`;
    setTimeout(() => alert.classList.remove('is-visible'), 4000);
  }

  // Expose functions globally for inline event handlers
  window.editRule = openRuleEditor;
  window.deleteRule = async (ruleId) => {
    if (!confirm('Delete this rule?')) return;
    try {
      const res = await fetch(`/api/admin/booking-rules/${ruleId}`, { method: 'DELETE' });
      if (res.ok) {
        showAlert('Rule deleted', 'success');
        await refreshRules();
      }
    } catch (err) {
      showAlert('Error deleting rule', 'error');
    }
  };

  window.deleteBlackout = async (blackoutId) => {
    if (!confirm('Delete this blackout period?')) return;
    try {
      const res = await fetch(
        `/api/admin/booking-rules/blackout-dates/${blackoutId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        showAlert('Blackout deleted', 'success');
        const dialog = document.querySelector('.modal-dialog');
        if (dialog) await loadBlackouts(dialog);
      }
    } catch (err) {
      showAlert('Error deleting blackout', 'error');
    }
  };
}
