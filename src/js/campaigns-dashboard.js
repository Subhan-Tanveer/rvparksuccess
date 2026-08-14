/**
 * Campaigns Dashboard — Promotional campaign management UI
 *
 * Features:
 * - Campaign list with filtering
 * - Campaign builder wizard
 * - Campaign detail view
 * - Performance tracking
 * - A/B testing interface
 */

import { confirmDialog, alertDialog, withLoading } from './ui-dialogs.js';

const CAMPAIGN_TYPES = {
  seasonal: 'Seasonal Promotions',
  loyalty: 'Loyalty Rewards',
  'event-driven': 'Event-Driven',
  behavioral: 'Behavioral Targeting',
  referral: 'Referral Program',
};

let currentPark = null;
let campaigns = [];
let currentCampaign = null;
let campaignListEl = null;
let campaignDetailEl = null;

export async function initCampaignsDashboard(park) {
  currentPark = park;

  // Render campaigns section placeholder
  const container = document.getElementById('campaignsDashboard');
  if (!container) {
    console.warn('campaigns-dashboard: #campaignsDashboard not found in HTML');
    return;
  }

  campaignListEl = container;

  // Initialize with empty state
  renderEmptyState();

  // Load campaigns
  await loadCampaigns();
}

async function loadCampaigns() {
  try {
    const res = await fetch(`/api/admin/features?resource=campaigns&parkId=${currentPark.id}`);
    if (!res.ok) throw new Error(await res.text());

    campaigns = await res.json();
    renderCampaignsList();
  } catch (err) {
    console.error('Failed to load campaigns:', err);
    showError('Failed to load campaigns');
  }
}

function renderEmptyState() {
  campaignListEl.innerHTML = `
    <div class="admin-section glass" data-reveal>
      <div class="section-head" style="margin-bottom: var(--sp-3);">
        <p class="eyebrow">Marketing Automation</p>
        <h2 style="font-size: 1.375rem;">Promotional Campaigns</h2>
      </div>
      <p style="color: var(--cream-dim); margin-bottom: var(--sp-4);">Create targeted email and SMS campaigns to drive bookings. Track performance with real-time metrics and A/B testing.</p>
      <button type="button" class="btn btn-primary" id="createCampaignBtn"><span>Create Campaign</span></button>
      <div style="margin-top: var(--sp-5); padding-top: var(--sp-5); border-top: 1px solid var(--border-glass);">
        <div class="admin-empty">No campaigns yet. Create your first one to get started.</div>
      </div>
    </div>
  `;

  document.getElementById('createCampaignBtn').addEventListener('click', openCampaignWizard);
}

function renderCampaignsList() {
  if (campaigns.length === 0) {
    renderEmptyState();
    return;
  }

  // Render campaigns list
  let html = `
    <div class="admin-section glass" data-reveal>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-4);">
        <div>
          <p class="eyebrow">Marketing Automation</p>
          <h2 style="font-size: 1.375rem;">Promotional Campaigns</h2>
        </div>
        <button type="button" class="btn btn-primary" id="createCampaignBtn"><span>New Campaign</span></button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--sp-3);">
  `;

  campaigns.forEach(campaign => {
    const status = getStatusBadge(campaign.status);
    const typeLabel = CAMPAIGN_TYPES[campaign.type] || campaign.type;
    const perf = campaign.performance || {};

    html += `
      <div class="campaign-card glass" data-campaign-id="${campaign.id}" style="padding: var(--sp-4); border-radius: var(--radius-lg); border: 1px solid var(--border-glass); cursor: pointer; transition: all 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: var(--sp-2);">
          <div>
            <h3 style="font-size: 1.125rem; font-weight: 600; margin: 0; color: var(--amber-light);">${campaign.name}</h3>
            <p style="font-size: 0.8125rem; color: var(--cream-dim); margin-top: 4px;">${typeLabel}</p>
          </div>
          <span class="status-chip ${status.cls}">${status.label}</span>
        </div>

        <div style="font-size: 0.875rem; color: var(--cream-dim); margin-bottom: var(--sp-3);">
          ${campaign.startDate} to ${campaign.endDate}
        </div>

        <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap: var(--sp-2); margin-bottom: var(--sp-3);">
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Recipients</div>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--amber-light);">${campaign.recipientCount}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Open Rate</div>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--amber-light);">${(perf.openRatePercent || 0).toFixed(1)}%</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Conversions</div>
            <div style="font-family: var(--font-mono); font-weight: 700; color: var(--amber-light);">${perf.conversions || 0}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">ROI</div>
            <div style="font-family: var(--font-mono); font-weight: 700; color: ${(perf.roiPercent || 0) >= 0 ? 'var(--amber-light)' : '#f0a89a'};">${(perf.roiPercent || 0).toFixed(1)}%</div>
          </div>
        </div>

        <button type="button" class="btn btn-ghost btn-sm view-campaign-btn" style="width: 100%;"><span>View Details</span></button>
      </div>
    `;
  });

  html += '</div></div>';

  campaignListEl.innerHTML = html;

  // Add event listeners
  document.getElementById('createCampaignBtn').addEventListener('click', openCampaignWizard);
  document.querySelectorAll('.view-campaign-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = e.target.closest('.campaign-card');
      const campaignId = card.dataset.campaignId;
      openCampaignDetail(campaignId);
    });
  });
}

async function openCampaignWizard() {
  const modal = createModalWithWizard();
  document.body.appendChild(modal);

  // Step 1: Campaign type selection
  const typeSelector = modal.querySelector('[data-step="1"]');
  typeSelector.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('.type-btn');
    if (typeBtn) {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('is-selected'));
      typeBtn.classList.add('is-selected');
    }
  });

  // Next button logic
  const nextButtons = modal.querySelectorAll('[data-action="next"]');
  nextButtons.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      const currentStep = modal.querySelector('.wizard-step.is-active');
      const nextStep = currentStep.nextElementSibling;
      if (nextStep) {
        currentStep.classList.remove('is-active');
        nextStep.classList.add('is-active');
        updateProgressBar(modal);
      }
    });
  });

  // Back button logic
  const backButtons = modal.querySelectorAll('[data-action="back"]');
  backButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const currentStep = modal.querySelector('.wizard-step.is-active');
      const prevStep = currentStep.previousElementSibling;
      if (prevStep) {
        currentStep.classList.remove('is-active');
        prevStep.classList.add('is-active');
        updateProgressBar(modal);
      }
    });
  });

  // Create button
  const createBtn = modal.querySelector('[data-action="create"]');
  createBtn.addEventListener('click', async () => {
    await createCampaignFromWizard(modal);
  });

  // Close button
  const closeBtn = modal.querySelector('[data-action="close"]');
  closeBtn.addEventListener('click', () => modal.remove());
}

function createModalWithWizard() {
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-content" style="max-width: 700px;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--sp-4); border-bottom: 1px solid var(--border-glass);">
        <h2 style="margin: 0; font-size: 1.375rem;">Create Campaign</h2>
        <button type="button" class="btn-close" data-action="close">×</button>
      </div>

      <div style="padding: var(--sp-4); max-height: 70vh; overflow-y: auto;">
        <!-- Progress bar -->
        <div style="margin-bottom: var(--sp-4);">
          <div style="display: flex; justify-content: space-between; margin-bottom: var(--sp-2);">
            <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Step <span class="progress-step">1</span> of 7</span>
            <span style="font-size: 0.75rem; color: var(--cream-dim);" class="progress-label">Campaign Type</span>
          </div>
          <div style="height: 4px; background: var(--surface-glass); border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: 14.28%; background: var(--amber); transition: width 0.3s ease;" class="progress-bar"></div>
          </div>
        </div>

        <!-- Step 1: Campaign Type -->
        <div class="wizard-step is-active" data-step="1">
          <h3 style="margin-top: 0;">Select Campaign Type</h3>
          <p style="color: var(--cream-dim); margin-bottom: var(--sp-3);">Choose the type of campaign that fits your goals.</p>
          <div style="display: grid; gap: var(--sp-2);">
            <button class="type-btn" data-type="seasonal" style="padding: var(--sp-3); text-align: left; border: 1px solid var(--border-glass); background: var(--surface-glass); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: 600; margin-bottom: 4px;">Seasonal Promotion</div>
              <div style="font-size: 0.875rem; color: var(--cream-dim);">Holiday or seasonal discounts</div>
            </button>
            <button class="type-btn" data-type="loyalty" style="padding: var(--sp-3); text-align: left; border: 1px solid var(--border-glass); background: var(--surface-glass); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: 600; margin-bottom: 4px;">Loyalty Rewards</div>
              <div style="font-size: 0.875rem; color: var(--cream-dim);">Reward repeat customers</div>
            </button>
            <button class="type-btn" data-type="event-driven" style="padding: var(--sp-3); text-align: left; border: 1px solid var(--border-glass); background: var(--surface-glass); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: 600; margin-bottom: 4px;">Event-Driven</div>
              <div style="font-size: 0.875rem; color: var(--cream-dim);">Triggered by bookings or cancellations</div>
            </button>
            <button class="type-btn" data-type="behavioral" style="padding: var(--sp-3); text-align: left; border: 1px solid var(--border-glass); background: var(--surface-glass); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: 600; margin-bottom: 4px;">Behavioral Targeting</div>
              <div style="font-size: 0.875rem; color: var(--cream-dim);">Target inactive or at-risk guests</div>
            </button>
            <button class="type-btn" data-type="referral" style="padding: var(--sp-3); text-align: left; border: 1px solid var(--border-glass); background: var(--surface-glass); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: 600; margin-bottom: 4px;">Referral Program</div>
              <div style="font-size: 0.875rem; color: var(--cream-dim);">Incentivize guest referrals</div>
            </button>
          </div>
        </div>

        <!-- Step 2: Campaign Details -->
        <div class="wizard-step" data-step="2" style="display: none;">
          <h3 style="margin-top: 0;">Campaign Details</h3>
          <div style="display: grid; gap: var(--sp-3);">
            <div class="field-float">
              <input type="text" id="campaignName" required placeholder=" ">
              <label for="campaignName">Campaign Name</label>
            </div>
            <div class="field-float">
              <input type="date" id="campaignStart" required placeholder=" ">
              <label for="campaignStart">Start Date</label>
            </div>
            <div class="field-float">
              <input type="date" id="campaignEnd" required placeholder=" ">
              <label for="campaignEnd">End Date</label>
            </div>
            <div class="field-float">
              <input type="number" id="campaignBudget" min="0" placeholder=" ">
              <label for="campaignBudget">Budget (optional, $)</label>
            </div>
            <div class="field-float">
              <textarea id="campaignDesc" placeholder=" " style="min-height: 80px;"></textarea>
              <label for="campaignDesc">Description</label>
            </div>
          </div>
        </div>

        <!-- Step 3: Offer Details -->
        <div class="wizard-step" data-step="3" style="display: none;">
          <h3 style="margin-top: 0;">Offer Details</h3>
          <div style="display: grid; gap: var(--sp-3);">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3);">
              <div class="field-float">
                <select id="discountType">
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed $ off</option>
                </select>
                <label for="discountType">Discount Type</label>
              </div>
              <div class="field-float">
                <input type="number" id="discountAmount" min="0" step="0.01" required placeholder=" ">
                <label for="discountAmount">Amount</label>
              </div>
            </div>
            <div class="field-float">
              <input type="text" id="promoCode" placeholder=" " style="text-transform: uppercase;">
              <label for="promoCode">Promo Code (optional)</label>
            </div>
          </div>
        </div>

        <!-- Step 4: Recipients -->
        <div class="wizard-step" data-step="4" style="display: none;">
          <h3 style="margin-top: 0;">Target Recipients</h3>
          <div style="display: grid; gap: var(--sp-2);">
            <label style="display: flex; align-items: center; padding: var(--sp-3); border: 1px solid var(--border-glass); border-radius: var(--radius-md); cursor: pointer;">
              <input type="radio" name="targetSegment" value="all" checked>
              <span style="margin-left: var(--sp-2); flex: 1;">All Guests</span>
            </label>
            <label style="display: flex; align-items: center; padding: var(--sp-3); border: 1px solid var(--border-glass); border-radius: var(--radius-md); cursor: pointer;">
              <input type="radio" name="targetSegment" value="loyal">
              <span style="margin-left: var(--sp-2); flex: 1;">Loyal Customers (3+ bookings)</span>
            </label>
            <label style="display: flex; align-items: center; padding: var(--sp-3); border: 1px solid var(--border-glass); border-radius: var(--radius-md); cursor: pointer;">
              <input type="radio" name="targetSegment" value="inactive">
              <span style="margin-left: var(--sp-2); flex: 1;">Inactive (60+ days)</span>
            </label>
            <label style="display: flex; align-items: center; padding: var(--sp-3); border: 1px solid var(--border-glass); border-radius: var(--radius-md); cursor: pointer;">
              <input type="radio" name="targetSegment" value="atrisk">
              <span style="margin-left: var(--sp-2); flex: 1;">At-Risk (pending cancellation)</span>
            </label>
          </div>
        </div>

        <!-- Step 5: Message Content -->
        <div class="wizard-step" data-step="5" style="display: none;">
          <h3 style="margin-top: 0;">Message Content</h3>
          <div style="display: grid; gap: var(--sp-3);">
            <div class="field-float">
              <input type="text" id="emailSubject" required placeholder=" ">
              <label for="emailSubject">Email Subject</label>
            </div>
            <div class="field-float">
              <textarea id="emailBody" placeholder=" " style="min-height: 120px;"></textarea>
              <label for="emailBody">Email Body (HTML, use {{discount}}, {{promoCode}}, {{name}})</label>
            </div>
            <div class="field-float">
              <textarea id="smsBody" placeholder=" " style="min-height: 60px;"></textarea>
              <label for="smsBody">SMS Text (max 160 chars)</label>
            </div>
          </div>
        </div>

        <!-- Step 6: A/B Testing -->
        <div class="wizard-step" data-step="6" style="display: none;">
          <h3 style="margin-top: 0;">A/B Testing (Optional)</h3>
          <p style="color: var(--cream-dim); margin-bottom: var(--sp-3);">Create a variant to test different messaging on 50% of recipients.</p>
          <label style="display: flex; align-items: center; margin-bottom: var(--sp-3); cursor: pointer;">
            <input type="checkbox" id="enableABTest">
            <span style="margin-left: var(--sp-2);">Enable A/B test</span>
          </label>
          <div id="abTestFields" style="display: none; border: 1px solid var(--border-glass); padding: var(--sp-3); border-radius: var(--radius-md);">
            <div style="display: grid; gap: var(--sp-3);">
              <div class="field-float">
                <input type="text" id="variantBSubject" placeholder=" ">
                <label for="variantBSubject">Variant B: Email Subject</label>
              </div>
              <div class="field-float">
                <textarea id="variantBBody" placeholder=" " style="min-height: 80px;"></textarea>
                <label for="variantBBody">Variant B: Email Body</label>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 7: Review -->
        <div class="wizard-step" data-step="7" style="display: none;">
          <h3 style="margin-top: 0;">Review & Create</h3>
          <div id="reviewSummary" style="padding: var(--sp-3); background: var(--surface-glass); border-radius: var(--radius-md); border: 1px solid var(--border-glass); font-size: 0.9375rem;"></div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; padding: var(--sp-4); border-top: 1px solid var(--border-glass); gap: var(--sp-2);">
        <div>
          <button type="button" class="btn btn-ghost" data-action="back" style="display: none;">Back</button>
        </div>
        <div style="display: flex; gap: var(--sp-2);">
          <button type="button" class="btn btn-ghost" data-action="close">Cancel</button>
          <button type="button" class="btn btn-primary" data-action="next" style="display: none;">Next</button>
          <button type="button" class="btn btn-primary" data-action="create" style="display: none;">Create Campaign</button>
        </div>
      </div>
    </div>
  `;

  // Add modal overlay styles
  const style = document.createElement('style');
  style.textContent = `
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }
    .modal-content {
      background: var(--surface-base);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-glass);
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    .btn-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--cream-dim);
      padding: 0;
      width: 32px;
      height: 32px;
    }
    .btn-close:hover {
      color: var(--amber-light);
    }
    .type-btn.is-selected {
      border-color: var(--amber);
      background: rgba(217,133,0,0.1);
    }
  `;
  document.head.appendChild(style);

  // Add A/B test toggle
  const abToggle = div.querySelector('#enableABTest');
  const abFields = div.querySelector('#abTestFields');
  abToggle.addEventListener('change', () => {
    abFields.style.display = abToggle.checked ? 'block' : 'none';
  });

  updateWizardButtons(div, 1);

  return div;
}

function updateWizardButtons(modal, step) {
  const nextBtn = modal.querySelector('[data-action="next"]');
  const backBtn = modal.querySelector('[data-action="back"]');
  const createBtn = modal.querySelector('[data-action="create"]');

  backBtn.style.display = step > 1 ? 'block' : 'none';
  nextBtn.style.display = step < 7 ? 'block' : 'none';
  createBtn.style.display = step === 7 ? 'block' : 'none';
}

function updateProgressBar(modal) {
  const activeStep = modal.querySelector('.wizard-step.is-active');
  const stepNum = parseInt(activeStep.dataset.step);
  const progress = (stepNum / 7) * 100;

  modal.querySelector('.progress-bar').style.width = progress + '%';
  modal.querySelector('.progress-step').textContent = stepNum;

  const labels = ['Campaign Type', 'Details', 'Offer', 'Recipients', 'Message', 'A/B Test', 'Review'];
  modal.querySelector('.progress-label').textContent = labels[stepNum - 1];

  updateWizardButtons(modal, stepNum);
}

async function createCampaignFromWizard(modal) {
  const campaignType = modal.querySelector('.type-btn.is-selected').dataset.type;
  const name = modal.querySelector('#campaignName').value;
  const startDate = modal.querySelector('#campaignStart').value;
  const endDate = modal.querySelector('#campaignEnd').value;
  const budget = parseFloat(modal.querySelector('#campaignBudget').value || 0) * 100;
  const description = modal.querySelector('#campaignDesc').value;
  const discountType = modal.querySelector('#discountType').value;
  const discountAmount = parseFloat(modal.querySelector('#discountAmount').value);
  const promoCode = modal.querySelector('#promoCode').value;

  if (!name || !startDate || !endDate || !discountAmount) {
    await alertDialog({ title: 'Missing Fields', message: 'Please fill out all required fields.' });
    return;
  }

  try {
    const res = await fetch('/api/admin/features?resource=campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        type: campaignType,
        startDate,
        endDate,
        budgetCents: budget || null,
        discountAmount,
        discountType,
        promoCode,
        description,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create campaign');
    }

    const campaign = await res.json();

    // If A/B test enabled, set up variants
    if (modal.querySelector('#enableABTest').checked) {
      const variantARes = await fetch(`/api/admin/features?resource=campaigns&campaignId=${campaign.id}&action=ab-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantA: {
            name: 'Variant A (Control)',
            subject: modal.querySelector('#emailSubject').value,
            body: modal.querySelector('#emailBody').value,
            smsBody: modal.querySelector('#smsBody').value,
          },
          variantB: {
            name: 'Variant B (Test)',
            subject: modal.querySelector('#variantBSubject').value,
            body: modal.querySelector('#variantBBody').value,
          },
        }),
      });

      if (!variantARes.ok) throw new Error('Failed to create A/B test');
    }

    modal.remove();
    await alertDialog({ title: 'Campaign Created', message: `"${name}" has been created successfully.` });
    await loadCampaigns();
  } catch (err) {
    await alertDialog({ title: 'Error', message: err.message });
  }
}

async function openCampaignDetail(campaignId) {
  try {
    const res = await fetch(`/api/admin/features?resource=campaigns&campaignId=${campaignId}`);
    if (!res.ok) throw new Error('Failed to load campaign');

    const campaign = await res.json();
    currentCampaign = campaign;

    renderCampaignDetailModal(campaign);
  } catch (err) {
    showError('Failed to load campaign details');
  }
}

function renderCampaignDetailModal(campaign) {
  const perf = campaign.performance || {};
  const typeLabel = CAMPAIGN_TYPES[campaign.type] || campaign.type;
  const status = getStatusBadge(campaign.status);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 800px; max-height: 85vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--sp-4); border-bottom: 1px solid var(--border-glass); position: sticky; top: 0; background: var(--surface-base); z-index: 10;">
        <div>
          <p class="eyebrow">${typeLabel}</p>
          <h2 style="margin: 0; font-size: 1.375rem;">${campaign.name}</h2>
        </div>
        <button type="button" class="btn-close">×</button>
      </div>

      <div style="padding: var(--sp-4);">
        <!-- Status and Dates -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: var(--sp-3); margin-bottom: var(--sp-4);">
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim); margin-bottom: 4px;">Status</div>
            <span class="status-chip ${status.cls}">${status.label}</span>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim); margin-bottom: 4px;">Start Date</div>
            <div style="font-weight: 600;">${campaign.startDate}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim); margin-bottom: 4px;">End Date</div>
            <div style="font-weight: 600;">${campaign.endDate}</div>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim); margin-bottom: 4px;">Discount</div>
            <div style="font-weight: 600;">${campaign.discountAmount}${campaign.discountType === 'percent' ? '%' : '$'}</div>
          </div>
        </div>

        <!-- Performance Metrics -->
        <div style="padding: var(--sp-3); background: var(--surface-glass); border-radius: var(--radius-md); border: 1px solid var(--border-glass); margin-bottom: var(--sp-4);">
          <h4 style="margin-top: 0; margin-bottom: var(--sp-3);">Performance Metrics</h4>
          <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--sp-2);">
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Recipients</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: var(--amber-light);">${campaign.recipientCount}</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Emails Sent</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: var(--amber-light);">${perf.emailsSent || 0}</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Open Rate</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: var(--amber-light);">${(perf.openRatePercent || 0).toFixed(1)}%</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Click Rate</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: var(--amber-light);">${(perf.clickRatePercent || 0).toFixed(1)}%</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">Conversions</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: var(--amber-light);">${perf.conversions || 0}</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--cream-dim);">ROI</div>
              <div style="font-family: var(--font-mono); font-size: 1.5rem; font-weight: 700; color: ${(perf.roiPercent || 0) >= 0 ? 'var(--amber-light)' : '#f0a89a'};">${(perf.roiPercent || 0).toFixed(1)}%</div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); flex-wrap: wrap;">
          ${campaign.status === 'draft' ? `
            <button type="button" class="btn btn-primary" data-action="execute">Send Campaign</button>
            <button type="button" class="btn btn-ghost" data-action="edit">Edit</button>
            <button type="button" class="btn btn-ghost" data-action="delete" style="color: #f0a89a;">Delete</button>
          ` : ''}
          ${campaign.status === 'active' ? `
            <button type="button" class="btn btn-ghost" data-action="pause">Pause</button>
            <button type="button" class="btn btn-ghost" data-action="duplicate">Duplicate</button>
          ` : ''}
          ${campaign.status === 'paused' ? `
            <button type="button" class="btn btn-primary" data-action="resume">Resume</button>
          ` : ''}
          <button type="button" class="btn btn-ghost" data-action="export">Export Results</button>
        </div>

        <!-- Description -->
        ${campaign.description ? `
          <div style="padding: var(--sp-3); background: var(--surface-glass); border-radius: var(--radius-md); border: 1px solid var(--border-glass); margin-bottom: var(--sp-4);">
            <h4 style="margin-top: 0; margin-bottom: var(--sp-2);">Description</h4>
            <p style="margin: 0; color: var(--cream-dim);">${campaign.description}</p>
          </div>
        ` : ''}

        <!-- A/B Test Results -->
        ${campaign.variants && campaign.variants.length > 0 ? `
          <div style="padding: var(--sp-3); background: var(--surface-glass); border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
            <h4 style="margin-top: 0; margin-bottom: var(--sp-3);">A/B Test Results</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3);">
              ${campaign.variants.map((v, idx) => `
                <div style="padding: var(--sp-2); border: 1px solid var(--border-glass); border-radius: var(--radius-md);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-2);">
                    <h5 style="margin: 0;">${v.variantName}</h5>
                    ${v.isWinner ? '<span style="color: var(--amber-light); font-weight: 600;">Winner</span>' : ''}
                  </div>
                  <div style="font-size: 0.875rem;">
                    <div style="margin-bottom: 8px;"><strong>Sent:</strong> ${v.emailsSent}</div>
                    <div style="margin-bottom: 8px;"><strong>Opened:</strong> ${v.emailsOpened} (${v.emailOpenRatePercent.toFixed(1)}%)</div>
                    <div style="margin-bottom: 8px;"><strong>Conversions:</strong> ${v.conversions}</div>
                    <div><strong>Revenue:</strong> $${(v.revenueCents / 100).toFixed(2)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  // Close button
  modal.querySelector('.btn-close').addEventListener('click', () => modal.remove());

  // Action buttons
  const executeBtn = modal.querySelector('[data-action="execute"]');
  if (executeBtn) {
    executeBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Send Campaign',
        message: `Send "${campaign.name}" to ${campaign.recipientCount} recipients?`,
        confirmLabel: 'Send', cancelLabel: 'Cancel',
      });
      if (ok) {
        try {
          await withLoading(executeBtn, async () => {
            const res = await fetch(`/api/admin/features?resource=campaigns&campaignId=${campaign.id}&action=execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) throw new Error(await res.text());
            await alertDialog({ title: 'Campaign Sent', message: 'Campaign has been sent successfully.' });
            modal.remove();
            await loadCampaigns();
          });
        } catch (err) {
          await alertDialog({ title: 'Error', message: err.message });
        }
      }
    });
  }

  document.body.appendChild(modal);
}

function getStatusBadge(status) {
  const badges = {
    draft: { cls: 'is-pending', label: 'Draft' },
    scheduled: { cls: 'is-pending', label: 'Scheduled' },
    active: { cls: 'is-confirmed', label: 'Active' },
    completed: { cls: 'is-confirmed', label: 'Completed' },
    paused: { cls: 'is-pending', label: 'Paused' },
  };
  return badges[status] || { cls: 'is-pending', label: status };
}

function showError(message) {
  const alert = document.createElement('div');
  alert.className = 'admin-alert is-visible is-error';
  alert.textContent = message;
  alert.style.cssText = 'position: fixed; top: var(--sp-4); right: var(--sp-4); max-width: 400px; z-index: 9999;';
  document.body.appendChild(alert);
  setTimeout(() => alert.remove(), 5000);
}
