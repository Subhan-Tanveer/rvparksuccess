// CRM Dashboard — guest profile management, communication history, tagging system
// Includes guest list, detail modal, segmentation view, and communication timeline

import { confirmDialog, alertDialog, withLoading } from './ui-dialogs.js';
import { infoIcon } from './info-icon.js';

const RISK_COLORS = {
  low: '#2e9b54',    // green
  medium: '#d97f2e', // orange
  high: '#d93c2e',   // red
};

const RISK_RANGES = {
  low: [0, 30],
  medium: [30, 60],
  high: [60, 100],
};

let currentPark = null;
let currentGuests = [];
let currentPage = 0;
let totalGuests = 0;
let selectedGuestEmail = null;
let filteredSegment = null;
let segments = {};

function formatUsd(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function riskBadgeColor(score) {
  if (score < 30) return RISK_COLORS.low;
  if (score < 60) return RISK_COLORS.medium;
  return RISK_COLORS.high;
}

function riskBadgeLabel(score) {
  if (score < 30) return 'Low';
  if (score < 60) return 'Medium';
  return 'High';
}

export async function initCrmDashboard(park) {
  currentPark = park;
  renderCrmContainer();
  await loadGuestList();
  await loadSegments();
}

function renderCrmContainer() {
  const container = document.getElementById('crmDashboard');
  if (!container) return;

  container.innerHTML = `
    <div class="crm-wrapper">
      <div class="crm-header">
        <h2>Guest CRM</h2>
        <div class="crm-search-bar">
          <input type="text" id="guestSearch" placeholder="Search guests..." class="crm-search-input">
          <select id="segmentFilter" class="crm-segment-filter">
            <option value="">All Guests</option>
            <option value="loyal">Loyal</option>
            <option value="occasional">Occasional</option>
            <option value="at-risk">At-Risk</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div class="crm-tabs">
        <button class="crm-tab-btn is-active" data-tab="guests">Guests</button>
        <button class="crm-tab-btn" data-tab="segments">Segmentation</button>
        <button class="crm-tab-btn" data-tab="at-risk">At-Risk</button>
      </div>

      <div id="guestsTabs" class="crm-tab-content">
        <div class="crm-guest-list">
          <table class="crm-guests-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Visits ${infoIcon('Number of confirmed bookings this guest has made at this park.')}</th>
                <th>Lifetime Value ${infoIcon('Meant to be the total this guest has ever spent across all their bookings. This is not automatically calculated yet, so it currently shows $0.00 for every guest.')}</th>
                <th>Risk Score ${infoIcon('Meant to be a 0-100 score flagging guests likely to cancel or not return. This is not automatically calculated yet, so every guest currently shows as Low (0).')}</th>
                <th>Last Booking ${infoIcon('Check-in date of this guest\'s most recent confirmed booking.')}</th>
                <th>Tags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="guestTableBody">
              <tr><td colspan="9" class="crm-loading">Loading guests...</td></tr>
            </tbody>
          </table>
          <div class="crm-pagination">
            <button id="prevPageBtn" class="crm-btn">Previous</button>
            <span id="pageInfo"></span>
            <button id="nextPageBtn" class="crm-btn">Next</button>
          </div>
        </div>
      </div>

      <div id="segmentsTabs" class="crm-tab-content" style="display: none;">
        <div class="crm-segments-grid">
          <div class="crm-segment-card" data-segment="loyal">
            <div class="crm-segment-label">Loyal ${infoIcon('Guests with a Risk Score under 30. Since Risk Score is not automatically calculated yet (it defaults to 0), this currently includes almost every guest.')}</div>
            <div class="crm-segment-count" id="segmentLoyalCount">0</div>
            <div class="crm-segment-ltv">Avg LTV: <span id="segmentLoyalLtv">--</span></div>
          </div>
          <div class="crm-segment-card" data-segment="occasional">
            <div class="crm-segment-label">Occasional ${infoIcon('Guests with a Risk Score between 30 and 60. Since Risk Score is not automatically calculated yet (it defaults to 0), this segment is typically empty.')}</div>
            <div class="crm-segment-count" id="segmentOccasionalCount">0</div>
            <div class="crm-segment-ltv">Avg LTV: <span id="segmentOccasionalLtv">--</span></div>
          </div>
          <div class="crm-segment-card" data-segment="at-risk">
            <div class="crm-segment-label">At-Risk ${infoIcon('Guests with a Risk Score over 60. Since Risk Score is not automatically calculated yet (it defaults to 0), this segment is typically empty.')}</div>
            <div class="crm-segment-count" id="segmentAtRiskCount">0</div>
            <div class="crm-segment-ltv">Avg LTV: <span id="segmentAtRiskLtv">--</span></div>
          </div>
          <div class="crm-segment-card" data-segment="inactive">
            <div class="crm-segment-label">Inactive ${infoIcon('Guests who have never been contacted, or not contacted in the last 90 days. Since contact dates are not automatically logged yet, this currently includes nearly every guest.')}</div>
            <div class="crm-segment-count" id="segmentInactiveCount">0</div>
            <div class="crm-segment-ltv">Avg LTV: <span id="segmentInactiveLtv">--</span></div>
          </div>
        </div>
      </div>

      <div id="atRiskTabs" class="crm-tab-content" style="display: none;">
        <h4 class="crm-section-title">At-Risk Guests ${infoIcon('Guests with a Risk Score above 50, meant to flag a higher chance of cancelling or not returning. Risk Score is not automatically calculated yet, so this list will typically be empty.')}</h4>
        <div id="atRiskList"></div>
      </div>
    </div>

    <div id="guestDetailModal" class="crm-modal" style="display: none;">
      <div class="crm-modal-content">
        <button class="crm-modal-close">&times;</button>
        <div class="crm-guest-detail">
          <div class="crm-guest-header">
            <div class="crm-guest-name-block">
              <h3 id="detailGuestName"></h3>
              <p id="detailGuestEmail"></p>
            </div>
            <div class="crm-guest-stats">
              <div class="crm-stat-item">
                <span class="crm-stat-label">Lifetime Value ${infoIcon('Meant to be the total this guest has ever spent across all their bookings. This is not automatically calculated yet, so it currently shows $0.00 for every guest.')}</span>
                <span class="crm-stat-value" id="detailLtv">--</span>
              </div>
              <div class="crm-stat-item">
                <span class="crm-stat-label">Stays ${infoIcon('Number of bookings on file for this guest, up to the 10 most recent shown below.')}</span>
                <span class="crm-stat-value" id="detailStays">--</span>
              </div>
              <div class="crm-stat-item">
                <span class="crm-stat-label">Risk Score ${infoIcon('Meant to be a 0-100 score flagging guests likely to cancel or not return. This is not automatically calculated yet, so every guest currently shows as Low (0).')}</span>
                <span class="crm-stat-value" id="detailRiskScore">--</span>
              </div>
            </div>
          </div>

          <div class="crm-detail-tabs">
            <button class="crm-detail-tab-btn is-active" data-tab="profile">Profile</button>
            <button class="crm-detail-tab-btn" data-tab="bookings">Bookings</button>
            <button class="crm-detail-tab-btn" data-tab="communications">Communications</button>
            <button class="crm-detail-tab-btn" data-tab="notes">Notes</button>
          </div>

          <div class="crm-detail-content">
            <div id="detailProfile" class="crm-detail-tab">
              <div class="crm-preferences-block">
                <h4>Preferences</h4>
                <div id="detailPreferences" class="crm-preferences-list"></div>
              </div>
              <div class="crm-tags-block">
                <h4>Tags</h4>
                <div id="detailTags" class="crm-tags-container"></div>
                <div class="crm-add-tag">
                  <input type="text" id="newTagInput" placeholder="Add new tag..." class="crm-tag-input">
                  <button id="addTagBtn" class="crm-btn-small">Add</button>
                </div>
              </div>
            </div>

            <div id="detailBookings" class="crm-detail-tab" style="display: none;">
              <div id="bookingsList" class="crm-bookings-list"></div>
            </div>

            <div id="detailCommunications" class="crm-detail-tab" style="display: none;">
              <div id="communicationsList" class="crm-communications-timeline"></div>
            </div>

            <div id="detailNotes" class="crm-detail-tab" style="display: none;">
              <div class="crm-notes-editor">
                <textarea id="newNoteText" placeholder="Add a note..." class="crm-note-textarea" maxlength="1000"></textarea>
                <button id="addNoteBtn" class="crm-btn-small">Add Note</button>
              </div>
              <div id="notesList" class="crm-notes-list"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  attachEventListeners();
}

function attachEventListeners() {
  // Tab switching
  document.querySelectorAll('.crm-tab-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tab = e.target.dataset.tab;
      document.querySelectorAll('.crm-tab-btn').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.crm-tab-content').forEach(t => t.style.display = 'none');
      e.target.classList.add('is-active');
      document.getElementById(`${tab}Tabs`).style.display = 'block';

      if (tab === 'at-risk') {
        await loadAtRiskGuests();
      }
    });
  });

  // Detail modal tabs
  document.querySelectorAll('.crm-detail-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      document.querySelectorAll('.crm-detail-tab-btn').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.crm-detail-tab').forEach(t => t.style.display = 'none');
      e.target.classList.add('is-active');
      document.getElementById(`detail${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.display = 'block';
    });
  });

  // Pagination
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      loadGuestList();
    }
  });

  // updatePaginationControls() already disables this button once
  // currentPage is the last page (computed from totalGuests, which
  // loadGuestList() already fetched) — no need for a second fetch here
  // just to re-derive the same answer.
  document.getElementById('nextPageBtn').addEventListener('click', () => {
    currentPage++;
    loadGuestList();
  });

  // Guest detail modal close
  document.querySelector('.crm-modal-close').addEventListener('click', () => {
    document.getElementById('guestDetailModal').style.display = 'none';
  });

  // Segment filter
  document.getElementById('segmentFilter').addEventListener('change', (e) => {
    filteredSegment = e.target.value;
    currentPage = 0;
    loadGuestList();
  });

  // Add tag
  document.getElementById('addTagBtn').addEventListener('click', async () => {
    const tagInput = document.getElementById('newTagInput');
    const tagName = tagInput.value.trim();
    if (!tagName) return;

    try {
      const res = await fetch('/api/admin/features?resource=crm&action=tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestEmail: selectedGuestEmail, tagName }),
      });

      if (!res.ok) {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error });
        return;
      }

      tagInput.value = '';
      await loadGuestDetail(selectedGuestEmail);
    } catch (err) {
      alertDialog({ title: 'Error', message: err.message });
    }
  });

  // Add note
  document.getElementById('addNoteBtn').addEventListener('click', async () => {
    const noteText = document.getElementById('newNoteText').value.trim();
    if (!noteText) return;

    try {
      const res = await fetch('/api/admin/features?resource=crm&action=note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestEmail: selectedGuestEmail, noteText }),
      });

      if (!res.ok) {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error });
        return;
      }

      document.getElementById('newNoteText').value = '';
      await loadGuestDetail(selectedGuestEmail);
    } catch (err) {
      alertDialog({ title: 'Error', message: err.message });
    }
  });

  // Segment cards
  document.querySelectorAll('.crm-segment-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const segment = e.currentTarget.dataset.segment;
      filteredSegment = segment;
      currentPage = 0;
      loadGuestList();

      // Switch back to guests tab
      document.querySelector('[data-tab="guests"]').click();
    });
  });
}

async function loadGuestList() {
  try {
    const res = await fetch(`/api/admin/features?resource=crm&action=guests&page=${currentPage}`);
    if (!res.ok) throw new Error('Failed to load guests');

    const { guests, total } = await res.json();
    currentGuests = guests;
    totalGuests = total;

    renderGuestTable(guests);
    updatePaginationControls();
  } catch (err) {
    console.error('Error loading guests:', err);
    alertDialog({ title: 'Error', message: err.message });
  }
}

async function loadSegments() {
  try {
    const res = await fetch('/api/admin/features?resource=crm&action=segments');
    if (!res.ok) throw new Error('Failed to load segments');

    const { segments: data } = await res.json();
    segments = data;

    document.getElementById('segmentLoyalCount').textContent = data.loyal.count;
    document.getElementById('segmentLoyalLtv').textContent = formatUsd(Math.round(data.loyal.avgLifetimeValue));
    document.getElementById('segmentOccasionalCount').textContent = data.occasional.count;
    document.getElementById('segmentOccasionalLtv').textContent = formatUsd(Math.round(data.occasional.avgLifetimeValue));
    document.getElementById('segmentAtRiskCount').textContent = data.atRisk.count;
    document.getElementById('segmentAtRiskLtv').textContent = formatUsd(Math.round(data.atRisk.avgLifetimeValue));
    document.getElementById('segmentInactiveCount').textContent = data.inactive.count;
    document.getElementById('segmentInactiveLtv').textContent = formatUsd(Math.round(data.inactive.avgLifetimeValue));
  } catch (err) {
    console.error('Error loading segments:', err);
  }
}

async function loadAtRiskGuests() {
  try {
    const res = await fetch('/api/admin/features?resource=crm&action=at-risk&limit=20');
    if (!res.ok) throw new Error('Failed to load at-risk guests');

    const { guests } = await res.json();
    const container = document.getElementById('atRiskList');

    if (guests.length === 0) {
      container.innerHTML = '<p class="crm-empty">No at-risk guests detected.</p>';
      return;
    }

    container.innerHTML = guests.map(guest => `
      <div class="crm-at-risk-item">
        <div class="crm-risk-info">
          <div class="crm-risk-score" style="background: ${riskBadgeColor(guest.riskScore)};">
            ${guest.riskScore}
          </div>
          <div>
            <strong>${guest.guestEmail}</strong>
            <p class="crm-risk-meta">LTV: ${formatUsd(guest.lifetimeValueCents)} | Risk: ${riskBadgeLabel(guest.riskScore)}</p>
          </div>
        </div>
        <button class="crm-btn-small" onclick="window.crmViewGuest('${guest.guestEmail}')">View Profile</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading at-risk guests:', err);
    alertDialog({ title: 'Error', message: err.message });
  }
}

function renderGuestTable(guests) {
  const tbody = document.getElementById('guestTableBody');

  if (guests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="crm-empty">No guests found.</td></tr>';
    return;
  }

  tbody.innerHTML = guests.map(guest => `
    <tr class="crm-table-row">
      <td>${guest.guestEmail.split('@')[0]}</td>
      <td><a href="javascript:void(0)" onclick="window.crmViewGuest('${guest.guestEmail}')" class="crm-link">${guest.guestEmail}</a></td>
      <td>${guest.guestPhone || '—'}</td>
      <td>${guest.bookingCount}</td>
      <td>${formatUsd(guest.lifetimeValueCents)}</td>
      <td>
        <span class="crm-risk-badge" style="background: ${riskBadgeColor(guest.riskScore)};">
          ${riskBadgeLabel(guest.riskScore)}
        </span>
      </td>
      <td>${guest.lastBooking ? formatDate(guest.lastBooking) : '—'}</td>
      <td>
        <div class="crm-tags-row">
          ${guest.tags.map(t => `<span class="crm-tag">${t.tagName}</span>`).join('')}
        </div>
      </td>
      <td>
        <button class="crm-btn-small" onclick="window.crmViewGuest('${guest.guestEmail}')">View</button>
      </td>
    </tr>
  `).join('');
}

async function loadGuestDetail(email) {
  selectedGuestEmail = email;

  try {
    const res = await fetch(`/api/admin/features?resource=crm&action=guest&guestEmail=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error('Failed to load guest');

    const { history } = await res.json();
    const { profile, notes, tags, communications, reservations } = history;

    // Show modal
    const modal = document.getElementById('guestDetailModal');
    modal.style.display = 'flex';

    // Profile info
    document.getElementById('detailGuestName').textContent = email.split('@')[0];
    document.getElementById('detailGuestEmail').textContent = email;
    document.getElementById('detailLtv').textContent = formatUsd(profile?.lifetimeValueCents || 0);
    document.getElementById('detailStays').textContent = reservations.length;
    document.getElementById('detailRiskScore').textContent = `${profile?.riskScore || 0} (${riskBadgeLabel(profile?.riskScore || 0)})`;

    // Preferences
    const prefsHtml = profile?.preferences && Object.keys(profile.preferences).length > 0
      ? Object.entries(profile.preferences).map(([k, v]) => `<li>${k}: ${v}</li>`).join('')
      : '<li class="crm-empty-item">No preferences set</li>';
    document.getElementById('detailPreferences').innerHTML = `<ul>${prefsHtml}</ul>`;

    // Tags
    document.getElementById('detailTags').innerHTML = tags.length > 0
      ? tags.map(t => `
          <span class="crm-tag-removable">
            ${t.tagName}
            <button class="crm-tag-remove" onclick="window.crmRemoveTag('${t.id}')">×</button>
          </span>
        `).join('')
      : '<p class="crm-empty-item">No tags yet</p>';

    // Bookings
    document.getElementById('bookingsList').innerHTML = reservations.length > 0
      ? reservations.map(r => `
          <div class="crm-booking-item">
            <div><strong>${formatDate(r.checkIn)} to ${formatDate(r.checkOut)}</strong></div>
            <div class="crm-booking-meta">
              <span>${r.nights} nights</span>
              <span>${formatUsd(r.totalCents)}</span>
              <span class="crm-status-chip">${r.status}</span>
            </div>
          </div>
        `).join('')
      : '<p class="crm-empty-item">No bookings found</p>';

    // Communications
    document.getElementById('communicationsList').innerHTML = communications.length > 0
      ? communications.map(c => `
          <div class="crm-timeline-item">
            <div class="crm-timeline-marker">${c.type.substring(0, 1).toUpperCase()}</div>
            <div class="crm-timeline-content">
              <div class="crm-timeline-header">
                <strong>${c.type}</strong>
                <span class="crm-timeline-date">${formatDate(c.timestamp)}</span>
              </div>
              ${c.subject ? `<p class="crm-timeline-subject">${c.subject}</p>` : ''}
              ${c.messagePreview ? `<p class="crm-timeline-preview">${c.messagePreview}</p>` : ''}
            </div>
          </div>
        `).join('')
      : '<p class="crm-empty-item">No communications logged</p>';

    // Notes
    document.getElementById('notesList').innerHTML = notes.length > 0
      ? notes.map(n => `
          <div class="crm-note-item">
            <div class="crm-note-text">${n.noteText}</div>
            <div class="crm-note-meta">${formatDate(n.createdAt)}</div>
          </div>
        `).join('')
      : '<p class="crm-empty-item">No notes yet</p>';

  } catch (err) {
    console.error('Error loading guest detail:', err);
    alertDialog({ title: 'Error', message: err.message });
  }
}

function updatePaginationControls() {
  const limit = 50;
  const totalPages = Math.ceil(totalGuests / limit);
  document.getElementById('pageInfo').textContent = `Page ${currentPage + 1} of ${Math.max(1, totalPages)}`;
  document.getElementById('prevPageBtn').disabled = currentPage === 0;
  document.getElementById('nextPageBtn').disabled = (currentPage + 1) >= totalPages;
}

// Global functions for inline event handlers
window.crmViewGuest = async (email) => {
  await loadGuestDetail(email);
};

window.crmRemoveTag = async (tagId) => {
  if (!await confirmDialog({ title: 'Remove Tag', message: 'Are you sure you want to remove this tag?' })) return;

  try {
    const res = await fetch(`/api/admin/features?resource=crm&action=tag&tagId=${tagId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove tag');

    await loadGuestDetail(selectedGuestEmail);
  } catch (err) {
    alertDialog({ title: 'Error', message: err.message });
  }
};
