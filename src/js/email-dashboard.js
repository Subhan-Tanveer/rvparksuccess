// Email Marketing Dashboard — displays email templates, campaigns, and metrics
// Manages sending pre-arrival, post-stay, recovery, and promo emails
// Handles email settings, unsubscribe management, and analytics

class EmailDashboard {
  constructor(containerId = 'emailDashboard') {
    this.container = document.getElementById(containerId);
    this.stats = null;
    this.park = null;
    this.logs = [];
  }

  async initialize() {
    try {
      const response = await fetch('/api/admin/email', { method: 'GET' });
      if (!response.ok) throw new Error('Failed to load email dashboard');

      const data = await response.json();
      this.park = data.park;
      this.stats = data.stats;
      this.logs = data.recentLogs;

      this.render();
    } catch (err) {
      console.error('Email dashboard initialization error:', err);
      this.showError(err.message);
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="email-dashboard">
        ${this.renderStatsCards()}
        ${this.renderSettingsSection()}
        ${this.renderTemplatesSection()}
        ${this.renderCampaignsSection()}
        ${this.renderLogsSection()}
      </div>
    `;

    this.attachEventListeners();
  }

  renderStatsCards() {
    const { stats } = this;
    return `
      <div class="stats-grid" data-reveal>
        <div class="stat-card glass">
          <div class="label">Emails Sent</div>
          <div class="value">${stats.totalSent || 0}</div>
          <div class="sub">this month</div>
        </div>
        <div class="stat-card glass">
          <div class="label">Open Rate</div>
          <div class="value">${stats.openRate || 0}%</div>
          <div class="sub">${stats.totalSent > 0 ? `${Math.round((stats.totalSent * stats.openRate) / 100)} opens` : 'No data yet'}</div>
        </div>
        <div class="stat-card glass">
          <div class="label">Click Rate</div>
          <div class="value">${stats.clickRate || 0}%</div>
          <div class="sub">${stats.totalSent > 0 ? `${Math.round((stats.totalSent * stats.clickRate) / 100)} clicks` : 'No data yet'}</div>
        </div>
        <div class="stat-card glass">
          <div class="label">Bounce Rate</div>
          <div class="value">${stats.bounceRate || 0}%</div>
          <div class="sub">${stats.totalSent > 0 ? `${Math.round((stats.totalSent * stats.bounceRate) / 100)} bounced` : 'No data yet'}</div>
        </div>
      </div>
    `;
  }

  renderSettingsSection() {
    const { park } = this;
    return `
      <div class="admin-section glass" data-reveal>
        <div class="section-head" style="margin-bottom: var(--sp-4);">
          <p class="eyebrow">Configuration</p>
          <h2 style="font-size: 1.375rem;">Email Settings</h2>
        </div>

        <div class="field-row-2" style="margin-bottom: var(--sp-4);">
          <div>
            <label class="field-label">Sender Email</label>
            <input type="email" class="field-control" id="senderEmail" value="${park.senderEmail || ''}" placeholder="bookings@rvparksuccess.com">
          </div>
          <div>
            <label class="field-label">Sender Name</label>
            <input type="text" class="field-control" id="senderName" value="${park.senderName || 'RVPark Success'}" placeholder="RVPark Success">
          </div>
        </div>

        <div class="field-row-2" style="margin-bottom: var(--sp-4);">
          <div>
            <label class="field-label">Email Provider</label>
            <select class="field-control" id="emailProvider">
              <option value="auto" ${!park.emailProvider || park.emailProvider === 'auto' ? 'selected' : ''}>Auto-detect</option>
              <option value="sendgrid" ${park.emailProvider === 'sendgrid' ? 'selected' : ''}>SendGrid</option>
              <option value="mailgun" ${park.emailProvider === 'mailgun' ? 'selected' : ''}>Mailgun</option>
              <option value="nodemailer" ${park.emailProvider === 'nodemailer' ? 'selected' : ''}>SMTP</option>
            </select>
          </div>
          <div>
            <label class="field-label">Loyalty Discount %</label>
            <input type="number" class="field-control" id="loyaltyDiscount" min="0" max="100" value="${park.loyaltyDiscountPercent || 15}">
          </div>
        </div>

        <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4);">
          <label class="checkbox">
            <input type="checkbox" id="emailsEnabled" ${park.emailsEnabled ? 'checked' : ''}>
            <span>Enable All Email Marketing</span>
          </label>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp-3); padding: var(--sp-3); background: var(--surface-glass); border-radius: var(--radius-md); margin-bottom: var(--sp-4);">
          <label class="checkbox">
            <input type="checkbox" id="emailPreArrival" ${park.emailPreArrival ? 'checked' : ''}>
            <span>Pre-Arrival (72h before)</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="emailPostStay" ${park.emailPostStay ? 'checked' : ''}>
            <span>Post-Stay (24h after)</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="emailRecovery" ${park.emailRecovery ? 'checked' : ''}>
            <span>Abandoned Booking Recovery</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="emailPromo" ${park.emailPromo ? 'checked' : ''}>
            <span>Seasonal Promotions</span>
          </label>
        </div>

        <div style="display: flex; gap: var(--sp-2);">
          <button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
          <button class="btn btn-ghost" id="testEmailBtn">Send Test Email</button>
        </div>
      </div>
    `;
  }

  renderTemplatesSection() {
    return `
      <div class="admin-section glass" data-reveal>
        <div class="section-head" style="margin-bottom: var(--sp-4);">
          <p class="eyebrow">Templates</p>
          <h2 style="font-size: 1.375rem;">Email Templates</h2>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-3); margin-bottom: var(--sp-4);">
          <div class="template-card glass" data-template="pre-arrival">
            <div style="font-weight: 600; margin-bottom: var(--sp-2);">Pre-Arrival</div>
            <p style="font-size: 0.875rem; color: var(--cream-dim); margin-bottom: var(--sp-2);">72 hours before check-in. Includes check-in details, WiFi, parking instructions.</p>
            <button class="btn btn-ghost btn-sm" onclick="emailDashboard.previewTemplate('pre-arrival')">Preview</button>
          </div>

          <div class="template-card glass" data-template="post-stay">
            <div style="font-weight: 600; margin-bottom: var(--sp-2);">Post-Stay</div>
            <p style="font-size: 0.875rem; color: var(--cream-dim); margin-bottom: var(--sp-2);">24 hours after checkout. Review request + loyalty discount offer.</p>
            <button class="btn btn-ghost btn-sm" onclick="emailDashboard.previewTemplate('post-stay')">Preview</button>
          </div>

          <div class="template-card glass" data-template="recovery">
            <div style="font-weight: 600; margin-bottom: var(--sp-2);">Recovery</div>
            <p style="font-size: 0.875rem; color: var(--cream-dim); margin-bottom: var(--sp-2);">Abandoned bookings. "You left something in your cart" + discount.</p>
            <button class="btn btn-ghost btn-sm" onclick="emailDashboard.previewTemplate('recovery')">Preview</button>
          </div>

          <div class="template-card glass" data-template="seasonal-promo">
            <div style="font-weight: 600; margin-bottom: var(--sp-2);">Seasonal Promo</div>
            <p style="font-size: 0.875rem; color: var(--cream-dim); margin-bottom: var(--sp-2);">Custom promotions. Off-season rates, weekends, loyalty program.</p>
            <button class="btn btn-ghost btn-sm" onclick="emailDashboard.previewTemplate('seasonal-promo')">Preview</button>
          </div>
        </div>

        <div id="templatePreviewModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 1000; padding: var(--sp-4);">
          <div style="background: var(--black); border: 1px solid var(--border-glass); border-radius: var(--radius-lg); max-width: 800px; margin: auto; max-height: 90vh; overflow-y: auto;">
            <div style="padding: var(--sp-4); border-bottom: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center;">
              <h3 id="templatePreviewTitle" style="margin: 0;">Template Preview</h3>
              <button class="btn btn-ghost" onclick="emailDashboard.closePreview()" style="padding: 0;">✕</button>
            </div>
            <iframe id="templatePreviewFrame" style="width: 100%; height: calc(90vh - 120px); border: none;"></iframe>
          </div>
        </div>
      </div>
    `;
  }

  renderCampaignsSection() {
    return `
      <div class="admin-section glass" data-reveal>
        <div class="section-head" style="margin-bottom: var(--sp-4);">
          <p class="eyebrow">Marketing</p>
          <h2 style="font-size: 1.375rem;">Seasonal Promotions</h2>
        </div>

        <div style="padding: var(--sp-4); background: var(--surface-glass); border-radius: var(--radius-md); margin-bottom: var(--sp-4);">
          <div class="field-row-2" style="margin-bottom: var(--sp-3);">
            <div>
              <label class="field-label">Campaign Title</label>
              <input type="text" class="field-control" id="promoTitle" placeholder="Labor Day Weekend Special">
            </div>
            <div>
              <label class="field-label">Promo Code</label>
              <input type="text" class="field-control" id="promoCode" placeholder="LABORDAY25">
            </div>
          </div>

          <div>
            <label class="field-label">Description</label>
            <textarea class="field-control" id="promoDescription" rows="3" placeholder="Special rates for Labor Day weekend..."></textarea>
          </div>

          <div class="field-row-2" style="margin: var(--sp-3) 0;">
            <div>
              <label class="field-label">Offer Details</label>
              <textarea class="field-control" id="promoDetails" rows="2" placeholder="15% off all site types, Fri-Sun nights only"></textarea>
            </div>
            <div>
              <label class="field-label">Valid Until</label>
              <input type="date" class="field-control" id="promoEndDate">
            </div>
          </div>

          <button class="btn btn-primary" id="sendPromoBtn" style="width: 100%;">Send Campaign to All Guests</button>
        </div>

        <div id="campaignConfirm" style="display: none; padding: var(--sp-3); background: rgba(217,127,46,0.1); border: 1px solid var(--border-amber); border-radius: var(--radius-md); margin-bottom: var(--sp-3);">
          <p style="margin: 0 0 var(--sp-2);">Are you sure? This will send to all guests in your database.</p>
          <div style="display: flex; gap: var(--sp-2);">
            <button class="btn btn-primary btn-sm" id="confirmPromoBtn">Yes, Send Now</button>
            <button class="btn btn-ghost btn-sm" id="cancelPromoBtn">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  renderLogsSection() {
    const { logs } = this;
    const tableRows = logs.map(log => `
      <tr>
        <td>${log.guestName}</td>
        <td>${log.guestEmail}</td>
        <td><code>${log.templateType}</code></td>
        <td>${new Date(log.sentAt).toLocaleDateString()}</td>
        <td class="status-chip ${log.deliveryStatus === 'bounced' ? 'is-canceled' : 'is-confirmed'}">${log.deliveryStatus || 'sent'}</td>
        <td>${log.openedCount} opens</td>
        <td>${log.clickedCount} clicks</td>
      </tr>
    `).join('');

    return `
      <div class="admin-section glass" data-reveal>
        <div class="section-head" style="margin-bottom: var(--sp-4);">
          <p class="eyebrow">Analytics</p>
          <h2 style="font-size: 1.375rem;">Recent Emails</h2>
        </div>

        ${logs.length > 0 ? `
          <div style="overflow-x: auto;">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Guest Name</th>
                  <th>Email</th>
                  <th>Template</th>
                  <th>Sent</th>
                  <th>Status</th>
                  <th>Opens</th>
                  <th>Clicks</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="admin-empty">No emails sent yet. Create your first campaign above!</div>
        `}
      </div>
    `;
  }

  attachEventListeners() {
    // Settings
    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('testEmailBtn')?.addEventListener('click', () => this.sendTestEmail());

    // Campaigns
    document.getElementById('sendPromoBtn')?.addEventListener('click', () => this.confirmPromo());
    document.getElementById('confirmPromoBtn')?.addEventListener('click', () => this.sendPromo());
    document.getElementById('cancelPromoBtn')?.addEventListener('click', () => this.cancelPromo());
  }

  async saveSettings() {
    const settings = {
      emailsEnabled: document.getElementById('emailsEnabled')?.checked,
      emailProvider: document.getElementById('emailProvider')?.value,
      senderEmail: document.getElementById('senderEmail')?.value,
      senderName: document.getElementById('senderName')?.value,
      emailPreArrival: document.getElementById('emailPreArrival')?.checked,
      emailPostStay: document.getElementById('emailPostStay')?.checked,
      emailRecovery: document.getElementById('emailRecovery')?.checked,
      emailPromo: document.getElementById('emailPromo')?.checked,
      loyaltyDiscountPercent: parseInt(document.getElementById('loyaltyDiscount')?.value || 15),
    };

    try {
      const response = await fetch('/api/admin/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-settings', ...settings }),
      });

      if (!response.ok) throw new Error('Failed to save settings');
      this.showSuccess('Settings saved successfully');
    } catch (err) {
      this.showError(err.message);
    }
  }

  async sendTestEmail() {
    const testEmail = prompt('Send test email to:', 'test@example.com');
    if (!testEmail) return;

    try {
      const response = await fetch('/api/admin/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-email', testEmail }),
      });

      if (!response.ok) throw new Error('Failed to send test email');
      this.showSuccess(`Test email sent to ${testEmail}`);
    } catch (err) {
      this.showError(err.message);
    }
  }

  async previewTemplate(templateType) {
    try {
      const response = await fetch('/api/admin/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview-template', templateType }),
      });

      if (!response.ok) throw new Error('Failed to load template preview');
      const data = await response.json();

      const modal = document.getElementById('templatePreviewModal');
      const frame = document.getElementById('templatePreviewFrame');
      const title = document.getElementById('templatePreviewTitle');

      title.textContent = `${templateType.charAt(0).toUpperCase() + templateType.slice(1)} Template Preview`;
      frame.srcdoc = data.html;
      modal.style.display = 'flex';
    } catch (err) {
      this.showError(err.message);
    }
  }

  closePreview() {
    document.getElementById('templatePreviewModal').style.display = 'none';
  }

  confirmPromo() {
    document.getElementById('campaignConfirm').style.display = 'block';
    document.getElementById('sendPromoBtn').disabled = true;
  }

  cancelPromo() {
    document.getElementById('campaignConfirm').style.display = 'none';
    document.getElementById('sendPromoBtn').disabled = false;
  }

  async sendPromo() {
    const promoData = {
      title: document.getElementById('promoTitle')?.value,
      code: document.getElementById('promoCode')?.value,
      description: document.getElementById('promoDescription')?.value,
      details: document.getElementById('promoDetails')?.value,
      endDate: document.getElementById('promoEndDate')?.value,
    };

    if (!promoData.title || !promoData.code) {
      this.showError('Title and code are required');
      return;
    }

    try {
      const response = await fetch('/api/admin/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-promo', ...promoData }),
      });

      if (!response.ok) throw new Error('Failed to send campaign');
      const data = await response.json();
      this.showSuccess(`Campaign sent! ${data.results.sent} emails delivered`);
      this.cancelPromo();
      this.initialize(); // Reload dashboard
    } catch (err) {
      this.showError(err.message);
    }
  }

  showSuccess(message) {
    console.log('Success:', message);
    // TODO: Add toast notification
  }

  showError(message) {
    console.error('Error:', message);
    // TODO: Add toast notification
  }
}

// Initialize on page load
let emailDashboard;
document.addEventListener('DOMContentLoaded', () => {
  emailDashboard = new EmailDashboard('emailDashboard');
  emailDashboard.initialize();
});
