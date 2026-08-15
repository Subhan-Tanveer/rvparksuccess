/**
 * Interactive Availability Calendar Grid
 * Provides drag-drop calendar interface for managing park reservations
 */

import { confirmDialog, alertDialog, formDialog, withLoading } from './ui-dialogs.js';

class CalendarGrid {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      viewMode: 'month', // 'week', '2week', 'month'
      startDate: new Date(),
      parkId: null,
      onReservationChange: null,
      ...options,
    };

    this.currentDate = new Date(this.options.startDate);
    this.sites = [];
    this.reservations = [];
    this.blockedDates = [];
    this.draggedCell = null;
    this.selectedCells = new Set();
    this.contextMenuCell = null;

    this.init();
  }

  async init() {
    this.render();
    await this.loadCalendarData();
  }

  render() {
    this.container.innerHTML = `
      <div class="calendar-grid-wrapper">
        <div class="calendar-header">
          <div class="calendar-nav">
            <button class="btn btn-ghost btn-sm" id="calPrevMonth" title="Previous month">◀</button>
            <input type="month" id="calMonthPicker" class="calendar-month-input">
            <button class="btn btn-ghost btn-sm" id="calNextMonth" title="Next month">▶</button>
            <button class="btn btn-ghost btn-sm" id="calToday" title="Jump to today">Today</button>
          </div>

          <div class="calendar-month-label" id="calMonthLabel"></div>

          <div class="calendar-view-selector">
            <button class="calendar-view-btn is-active" data-view="week">Week</button>
            <button class="calendar-view-btn" data-view="2week">2 Weeks</button>
            <button class="calendar-view-btn" data-view="month">Month</button>
          </div>

          <div class="calendar-controls">
            <div class="calendar-filter-group">
              <label for="calSiteFilter">Site:</label>
              <select id="calSiteFilter">
                <option value="">All Sites</option>
              </select>
            </div>
            <div class="calendar-filter-group">
              <label for="calStatusFilter">Status:</label>
              <select id="calStatusFilter">
                <option value="">All Status</option>
                <option value="available">Available</option>
                <option value="booked">Booked</option>
                <option value="pending">Pending</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
        </div>

        <div class="calendar-legend">
          <div class="legend-item">
            <div class="legend-dot available"></div>
            <span>Available</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot booked"></div>
            <span>Booked</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot pending"></div>
            <span>Pending</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot partial"></div>
            <span>Partial</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot blocked"></div>
            <span>Blocked/Maintenance</span>
          </div>
        </div>

        <div class="calendar-grid-container">
          <div class="calendar-grid-scroll" id="calGridScrollWrap">
            <div class="calendar-day-headers" id="calDayHeaders"></div>
            <div class="calendar-grid-rows" id="calGridRows"></div>
          </div>
          <div class="calendar-month-view" id="calMonthView">
            <div class="calendar-month-headers" id="calMonthHeaders"></div>
            <div class="calendar-month-grid" id="calMonthGrid"></div>
          </div>
        </div>

        <div class="calendar-sidebar">
          <div class="calendar-stats" id="calStats"></div>
        </div>

        <div class="calendar-context-menu" id="calContextMenu"></div>
      </div>

      <div class="calendar-dialog" id="calDialog">
        <div class="calendar-dialog-content" id="calDialogContent"></div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    // Month navigation
    document.getElementById('calPrevMonth').addEventListener('click', () => this.previousMonth());
    document.getElementById('calNextMonth').addEventListener('click', () => this.nextMonth());
    document.getElementById('calToday').addEventListener('click', () => this.goToToday());
    document.getElementById('calMonthPicker').addEventListener('change', (e) => this.jumpToMonth(e.target.value));

    // View mode
    document.querySelectorAll('.calendar-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.changeViewMode(btn.dataset.view));
    });

    // Filters
    document.getElementById('calSiteFilter').addEventListener('change', () => this.redraw());
    document.getElementById('calStatusFilter').addEventListener('change', () => this.redraw());

    // Close context menu on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.calendar-context-menu')) {
        this.hideContextMenu();
      }
    });

    // Close dialog on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideDialog();
      }
    });

    document.getElementById('calDialog').addEventListener('click', (e) => {
      if (e.target.id === 'calDialog') {
        this.hideDialog();
      }
    });
  }

  async loadCalendarData() {
    try {
      const year = this.currentDate.getFullYear();
      const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
      const monthStr = `${year}-${month}`;

      const res = await fetch(`/api/admin/ops?resource=calendar&parkId=${this.options.parkId}&month=${monthStr}`);
      if (!res.ok) throw new Error('Failed to load calendar data');

      const data = await res.json();
      this.sites = data.sites || [];
      this.reservations = data.reservations || [];
      this.blockedDates = data.blockedDates || [];

      this.populateSiteFilter();
      this.redraw();
    } catch (err) {
      console.error('Calendar load error:', err);
      alertDialog({ title: 'Error', message: 'Failed to load calendar data' });
    }
  }

  populateSiteFilter() {
    const select = document.getElementById('calSiteFilter');
    const currentValue = select.value;
    const options = select.querySelectorAll('option:not(:first-child)');
    options.forEach((opt) => opt.remove());

    this.sites.forEach((site) => {
      const option = document.createElement('option');
      option.value = site.id;
      option.textContent = site.name;
      select.appendChild(option);
    });

    select.value = currentValue;
  }

  redraw() {
    this.updateMonthLabel();

    const scrollWrap = document.getElementById('calGridScrollWrap');
    const monthView = document.getElementById('calMonthView');

    if (this.options.viewMode === 'month') {
      scrollWrap.style.display = 'none';
      monthView.style.display = '';
      this.drawMonthView();
    } else {
      scrollWrap.style.display = '';
      monthView.style.display = 'none';
      this.drawDayHeaders();
      this.drawGrid();
    }

    this.drawStats();
  }

  updateMonthLabel() {
    const label = this.currentDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    document.getElementById('calMonthLabel').textContent = label;
    document.getElementById('calMonthPicker').value = `${this.currentDate.getFullYear()}-${String(this.currentDate.getMonth() + 1).padStart(2, '0')}`;
  }

  getVisibleDates() {
    let startDate = new Date(this.currentDate);
    let endDate = new Date(this.currentDate);

    if (this.options.viewMode === 'week') {
      startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate.setDate(startDate.getDate() + 6);
    } else if (this.options.viewMode === '2week') {
      startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate.setDate(startDate.getDate() + 13);
    } else {
      // month view
      startDate.setDate(1);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);
    }

    const dates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  // ---- Month view (traditional wall-calendar layout) ----

  getMonthWeeks() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    const startDate = new Date(year, month, 1);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // back to Sunday

    const endDate = new Date(year, month + 1, 0); // last day of month
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // forward to Saturday

    const weeks = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }

  getDaySummary(sites, dateStr) {
    const counts = { available: 0, booked: 0, pending: 0, partial: 0, blocked: 0 };
    sites.forEach((site) => {
      const status = this.getCellStatus(site.id, dateStr);
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }

  getDaySummaryHtml(counts) {
    const order = ['available', 'booked', 'pending', 'partial', 'blocked'];
    const parts = order
      .filter((status) => counts[status] > 0)
      .map((status) => `<span class="calendar-month-dot ${status}"><span class="dot"></span>${counts[status]}</span>`)
      .join('');
    return parts || '<span class="calendar-month-day-empty">—</span>';
  }

  drawMonthView() {
    const weeks = this.getMonthWeeks();
    const currentMonth = this.currentDate.getMonth();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const siteFilter = document.getElementById('calSiteFilter').value;
    const statusFilter = document.getElementById('calStatusFilter').value;
    const sites = siteFilter ? this.sites.filter((s) => s.id === siteFilter) : this.sites;

    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    document.getElementById('calMonthHeaders').innerHTML = dow
      .map((d) => `<div class="calendar-month-header-cell">${d}</div>`)
      .join('');

    let html = '';
    weeks.forEach((week) => {
      html += '<div class="calendar-month-week">';
      week.forEach((date) => {
        const dateStr = date.toISOString().split('T')[0];
        const isOtherMonth = date.getMonth() !== currentMonth;
        const isToday = date.toDateString() === today.toDateString();
        const counts = this.getDaySummary(sites, dateStr);
        const matchesStatusFilter = !statusFilter || counts[statusFilter] > 0;

        const classes = [
          'calendar-month-day',
          isOtherMonth ? 'is-other-month' : '',
          isToday ? 'is-today' : '',
          !matchesStatusFilter ? 'is-filtered-out' : '',
        ].filter(Boolean).join(' ');

        html += `
          <div class="${classes}" data-date="${dateStr}">
            <div class="calendar-month-day-number">${date.getDate()}</div>
            <div class="calendar-month-day-summary">${this.getDaySummaryHtml(counts)}</div>
          </div>
        `;
      });
      html += '</div>';
    });

    document.getElementById('calMonthGrid').innerHTML = html;

    document.querySelectorAll('.calendar-month-day').forEach((box) => {
      box.addEventListener('click', () => this.showDayDetail(box.dataset.date));
    });
  }

  showDayDetail(dateStr) {
    const siteFilter = document.getElementById('calSiteFilter').value;
    const sites = siteFilter ? this.sites.filter((s) => s.id === siteFilter) : this.sites;
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const rows = sites.map((site) => {
      const status = this.getCellStatus(site.id, dateStr);
      const reservation = this.getReservationForCell(site.id, dateStr);

      let detail = '';
      if (status === 'available') {
        detail = `<button type="button" class="btn btn-ghost btn-sm" data-action="quick-book" data-site="${site.id}">Quick Book</button>`;
      } else if (status === 'blocked') {
        detail = `<button type="button" class="btn btn-ghost btn-sm" data-action="unblock" data-site="${site.id}">Unblock</button>`;
      } else if (reservation) {
        detail = `
          <span>${reservation.guestName}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-action="view-details" data-site="${site.id}">Details</button>
        `;
      }

      return `
        <div class="calendar-day-detail-row">
          <div class="calendar-day-detail-site">
            <span class="calendar-cell ${status} calendar-day-detail-chip"></span>
            <strong>${site.name}</strong>
            <span class="calendar-site-name-meta">&nbsp;${site.type}</span>
          </div>
          <div class="calendar-day-detail-actions">${detail}</div>
        </div>
      `;
    }).join('');

    const dialogContent = document.getElementById('calDialogContent');
    dialogContent.innerHTML = `
      <div class="calendar-dialog-title">${dateLabel}</div>
      <div class="calendar-day-detail-list">${rows}</div>
      <div class="calendar-dialog-buttons">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('calDialog').classList.remove('is-visible');">Close</button>
      </div>
    `;

    dialogContent.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const siteId = btn.dataset.site;
        this.hideDialog();
        if (action === 'quick-book') this.quickBookDialog(siteId, dateStr);
        else if (action === 'unblock') this.unblockDate(siteId, dateStr);
        else if (action === 'view-details') this.showReservationDetails(siteId, dateStr);
      });
    });

    document.getElementById('calDialog').classList.add('is-visible');
  }

  drawDayHeaders() {
    const dates = this.getVisibleDates();
    const headersContainer = document.getElementById('calDayHeaders');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '<div class="calendar-day-header" style="border: none;"></div>';
    dates.forEach((date) => {
      const isToday = date.toDateString() === today.toDateString();
      const dateStr = date.getDate();
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];

      html += `
        <div class="calendar-day-header" ${isToday ? 'style="border-right: 2px solid var(--amber);"' : ''}>
          <span class="calendar-day-header-date">${dateStr}</span>
          <span class="calendar-day-header-dow">${dow}</span>
        </div>
      `;
    });

    headersContainer.innerHTML = html;
  }

  drawGrid() {
    const dates = this.getVisibleDates();
    const siteFilter = document.getElementById('calSiteFilter').value;
    const statusFilter = document.getElementById('calStatusFilter').value;
    const sites = siteFilter ? this.sites.filter((s) => s.id === siteFilter) : this.sites;

    const rowsContainer = document.getElementById('calGridRows');
    let html = '';

    sites.forEach((site) => {
      html += '<div class="calendar-row">';
      html += `
        <div class="calendar-site-name">
          <span class="calendar-site-name-main">${site.name}</span>
          <span class="calendar-site-name-meta">${site.type}</span>
        </div>
      `;

      dates.forEach((date) => {
        const dateStr = date.toISOString().split('T')[0];
        const status = this.getCellStatus(site.id, dateStr);
        const reservation = this.getReservationForCell(site.id, dateStr);

        if (statusFilter && status !== statusFilter) {
          html += '<div class="calendar-cell" style="display:none;"></div>';
        } else {
          html += `
            <div class="calendar-cell ${status}" data-site="${site.id}" data-date="${dateStr}">
              <div class="calendar-cell-content">
                ${this.getCellContent(status, reservation)}
                <div class="calendar-tooltip">${this.getTooltipContent(status, reservation)}</div>
              </div>
            </div>
          `;
        }
      });

      html += '</div>';
    });

    rowsContainer.innerHTML = html;
    this.attachCellEventListeners();
  }

  getCellStatus(siteId, dateStr) {
    const isBlocked = this.blockedDates.some((b) => b.siteId === siteId && b.date === dateStr);
    if (isBlocked) return 'blocked';

    const reservation = this.getReservationForCell(siteId, dateStr);
    if (!reservation) return 'available';

    if (reservation.status === 'pending') return 'pending';

    // Check if this is the start of a multi-night reservation
    const checkInDate = reservation.checkInDate;
    const isFirstNight = checkInDate === dateStr;

    return isFirstNight ? 'partial' : 'booked';
  }

  getReservationForCell(siteId, dateStr) {
    return this.reservations.find((r) => {
      return (
        r.siteId === siteId &&
        dateStr >= r.checkInDate &&
        dateStr < r.checkOutDate
      );
    });
  }

  getCellContent(status, reservation) {
    if (status === 'available') return '✓';
    if (status === 'blocked') return '◆';

    if (reservation) {
      const guestName = reservation.guestName || 'Guest';
      const shortName = guestName.split(' ')[0].slice(0, 6);
      return `<span class="calendar-cell-label">${shortName}</span>`;
    }

    return '';
  }

  getTooltipContent(status, reservation) {
    if (status === 'blocked') return 'Blocked • Click to unblock';
    if (!reservation) return 'Available • Click to book';

    return `
      ${reservation.guestName}<br>
      ${this.formatDateRange(reservation.checkInDate, reservation.checkOutDate)}<br>
      ${this.formatUsd(reservation.totalCents)}
    `;
  }

  formatDateRange(checkInStr, checkOutStr) {
    const checkIn = new Date(checkInStr + 'T00:00:00');
    const checkOut = new Date(checkOutStr + 'T00:00:00');
    return `${checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  formatUsd(cents) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  attachCellEventListeners() {
    document.querySelectorAll('.calendar-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => this.handleCellClick(e, cell));
      cell.addEventListener('dblclick', (e) => this.handleCellDoubleClick(e, cell));
      cell.addEventListener('contextmenu', (e) => this.handleCellContextMenu(e, cell));
      cell.addEventListener('dragstart', (e) => this.handleDragStart(e, cell));
      cell.addEventListener('dragover', (e) => this.handleDragOver(e, cell));
      cell.addEventListener('drop', (e) => this.handleDrop(e, cell));
      cell.addEventListener('dragend', (e) => this.handleDragEnd(e, cell));
    });
  }

  handleCellClick(e, cell) {
    e.preventDefault();
    const siteId = cell.dataset.site;
    const dateStr = cell.dataset.date;
    const status = cell.classList.contains('available') ? 'available' : null;

    if (e.shiftKey) {
      this.toggleCellSelection(cell);
      return;
    }

    if (status === 'available') {
      this.quickBookDialog(siteId, dateStr);
    } else if (cell.classList.contains('booked') || cell.classList.contains('pending')) {
      this.showReservationDetails(siteId, dateStr);
    } else if (cell.classList.contains('blocked')) {
      this.unblockDate(siteId, dateStr);
    }
  }

  handleCellDoubleClick(e, cell) {
    e.preventDefault();
    const siteId = cell.dataset.site;
    const dateStr = cell.dataset.date;

    if (cell.classList.contains('booked') || cell.classList.contains('pending')) {
      this.editReservationDialog(siteId, dateStr);
    }
  }

  handleCellContextMenu(e, cell) {
    e.preventDefault();
    this.showContextMenu(e, cell);
  }

  handleDragStart(e, cell) {
    if (!cell.classList.contains('booked') && !cell.classList.contains('pending')) return;
    this.draggedCell = cell;
    e.dataTransfer.effectAllowed = 'move';
  }

  handleDragOver(e, cell) {
    if (!this.draggedCell) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    cell.style.opacity = '0.5';
  }

  handleDrop(e, cell) {
    if (!this.draggedCell) return;
    e.preventDefault();
    cell.style.opacity = '1';

    const srcSiteId = this.draggedCell.dataset.site;
    const srcDateStr = this.draggedCell.dataset.date;
    const dstSiteId = cell.dataset.site;
    const dstDateStr = cell.dataset.date;

    if (srcSiteId === dstSiteId && srcDateStr === dstDateStr) return;

    const reservation = this.getReservationForCell(srcSiteId, srcDateStr);
    if (reservation) {
      this.moveReservation(reservation, dstSiteId, dstDateStr);
    }
  }

  handleDragEnd(e, cell) {
    cell.style.opacity = '1';
    this.draggedCell = null;
  }

  toggleCellSelection(cell) {
    if (this.selectedCells.has(cell)) {
      this.selectedCells.delete(cell);
      cell.classList.remove('selected');
    } else {
      this.selectedCells.add(cell);
      cell.classList.add('selected');
    }
  }

  showContextMenu(e, cell) {
    const menu = document.getElementById('calContextMenu');
    const siteId = cell.dataset.site;
    const dateStr = cell.dataset.date;
    const status = this.getCellStatus(siteId, dateStr);
    const reservation = this.getReservationForCell(siteId, dateStr);

    let html = '';

    if (status === 'available') {
      html += `<div class="calendar-menu-item" data-action="quick-book">Quick Book</div>`;
      html += `<div class="calendar-menu-item" data-action="block-date">Block Date</div>`;
    } else if (status === 'booked' || status === 'pending') {
      html += `<div class="calendar-menu-item" data-action="view-details">View Details</div>`;
      html += `<div class="calendar-menu-item" data-action="edit-reservation">Edit</div>`;
      html += `<div class="calendar-menu-item" data-action="change-site">Change Site</div>`;
      html += `<div class="calendar-menu-item is-danger" data-action="cancel-reservation">Cancel</div>`;
    } else if (status === 'blocked') {
      html += `<div class="calendar-menu-item" data-action="unblock-date">Unblock Date</div>`;
    }

    menu.innerHTML = html;
    menu.classList.add('is-visible');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    document.querySelectorAll('.calendar-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        this.handleContextMenuAction(action, siteId, dateStr, reservation);
        this.hideContextMenu();
      });
    });

    this.contextMenuCell = cell;
  }

  hideContextMenu() {
    document.getElementById('calContextMenu').classList.remove('is-visible');
  }

  async handleContextMenuAction(action, siteId, dateStr, reservation) {
    switch (action) {
      case 'quick-book':
        this.quickBookDialog(siteId, dateStr);
        break;
      case 'block-date':
        this.blockDateDialog(siteId, dateStr);
        break;
      case 'view-details':
        this.showReservationDetails(siteId, dateStr);
        break;
      case 'edit-reservation':
        this.editReservationDialog(siteId, dateStr);
        break;
      case 'change-site':
        if (reservation) {
          this.changeSiteDialog(reservation);
        }
        break;
      case 'cancel-reservation':
        if (reservation) {
          this.cancelReservation(reservation);
        }
        break;
      case 'unblock-date':
        this.unblockDate(siteId, dateStr);
        break;
    }
  }

  async quickBookDialog(siteId, dateStr) {
    const site = this.sites.find((s) => s.id === siteId);
    const values = await formDialog({
      title: `Quick Book — ${site.name}`,
      submitLabel: 'Book Now',
      fields: [
        { id: 'guestName', label: 'Guest Name', required: true },
        { id: 'guestPhone', label: 'Phone (optional)' },
        { id: 'checkInDate', label: 'Check-In', type: 'date', value: dateStr, required: true },
        { id: 'nights', label: 'Nights', type: 'number', min: 1, value: '1', required: true },
      ],
    });

    if (!values) return;

    const checkOutDate = new Date(values.checkInDate);
    checkOutDate.setDate(checkOutDate.getDate() + parseInt(values.nights));
    const checkOutStr = checkOutDate.toISOString().split('T')[0];

    await withLoading(null, async () => {
      const res = await fetch('/api/admin/ops?resource=calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-reservation',
          siteId,
          guestName: values.guestName,
          guestPhone: values.guestPhone || null,
          checkInDate: values.checkInDate,
          checkOutDate: checkOutStr,
          paymentMethod: 'cash',
        }),
      });

      if (res.ok) {
        await this.loadCalendarData();
        if (this.options.onReservationChange) {
          this.options.onReservationChange();
        }
      } else {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error || 'Could not create reservation' });
      }
    });
  }

  async blockDateDialog(siteId, dateStr) {
    const values = await formDialog({
      title: 'Block Date',
      submitLabel: 'Block',
      fields: [
        { id: 'startDate', label: 'Start Date', type: 'date', value: dateStr, required: true },
        { id: 'endDate', label: 'End Date', type: 'date', value: dateStr, required: true },
        { id: 'reason', label: 'Reason (optional)' },
      ],
    });

    if (!values) return;

    await withLoading(null, async () => {
      const res = await fetch('/api/admin/ops?resource=calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'block-dates',
          siteId,
          startDate: values.startDate,
          endDate: values.endDate,
          reason: values.reason,
        }),
      });

      if (res.ok) {
        await this.loadCalendarData();
      } else {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error || 'Could not block date' });
      }
    });
  }

  async unblockDate(siteId, dateStr) {
    const ok = await confirmDialog({
      title: 'Unblock Date',
      message: 'Remove this blocked date?',
      confirmLabel: 'Unblock',
    });

    if (!ok) return;

    await withLoading(null, async () => {
      const res = await fetch('/api/admin/ops?resource=calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unblock-date',
          siteId,
          date: dateStr,
        }),
      });

      if (res.ok) {
        await this.loadCalendarData();
      } else {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error || 'Could not unblock date' });
      }
    });
  }

  showReservationDetails(siteId, dateStr) {
    const reservation = this.getReservationForCell(siteId, dateStr);
    if (!reservation) return;

    const dialogContent = document.getElementById('calDialogContent');
    dialogContent.innerHTML = `
      <div class="calendar-dialog-title">${reservation.guestName}</div>
      <div style="font-size: 0.9375rem; color: var(--cream); margin-bottom: var(--sp-3);">
        <div style="margin-bottom: var(--sp-2);">
          <strong>Check-In:</strong> ${new Date(reservation.checkInDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div style="margin-bottom: var(--sp-2);">
          <strong>Check-Out:</strong> ${new Date(reservation.checkOutDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div style="margin-bottom: var(--sp-2);">
          <strong>Total:</strong> ${this.formatUsd(reservation.totalCents)}
        </div>
        <div style="margin-bottom: var(--sp-2);">
          <strong>Status:</strong> <span class="status-chip is-${reservation.status}">${reservation.status}</span>
        </div>
        ${reservation.guestPhone ? `<div style="margin-bottom: var(--sp-2);"><strong>Phone:</strong> ${reservation.guestPhone}</div>` : ''}
        ${reservation.guestEmail ? `<div style="margin-bottom: var(--sp-2);"><strong>Email:</strong> ${reservation.guestEmail}</div>` : ''}
      </div>
      <div class="calendar-dialog-buttons">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('calDialog').classList.remove('is-visible');">Close</button>
      </div>
    `;

    document.getElementById('calDialog').classList.add('is-visible');
  }

  editReservationDialog(siteId, dateStr) {
    const reservation = this.getReservationForCell(siteId, dateStr);
    if (!reservation) return;

    alertDialog({
      title: 'Edit Reservation',
      message: 'Full reservation editing coming soon. Use the main dashboard for now.',
    });
  }

  async moveReservation(reservation, newSiteId, newDateStr) {
    const ok = await confirmDialog({
      title: 'Move Reservation',
      message: `Move ${reservation.guestName} to a different date/site?`,
      confirmLabel: 'Move',
    });

    if (!ok) return;

    // Calculate new checkout date based on original length
    const checkInDate = new Date(reservation.checkInDate);
    const checkOutDate = new Date(reservation.checkOutDate);
    const nights = (checkOutDate - checkInDate) / (1000 * 60 * 60 * 24);

    const newCheckInDate = new Date(newDateStr);
    const newCheckOutDate = new Date(newCheckInDate);
    newCheckOutDate.setDate(newCheckOutDate.getDate() + nights);
    const newCheckOutStr = newCheckOutDate.toISOString().split('T')[0];

    await withLoading(null, async () => {
      const res = await fetch('/api/admin/ops?resource=calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move-reservation',
          reservationId: reservation.id,
          newSiteId,
          newCheckInDate: newDateStr,
          newCheckOutDate: newCheckOutStr,
        }),
      });

      if (res.ok) {
        await this.loadCalendarData();
        if (this.options.onReservationChange) {
          this.options.onReservationChange();
        }
      } else {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error || 'Could not move reservation' });
      }
    });
  }

  async changeSiteDialog(reservation) {
    alertDialog({
      title: 'Change Site',
      message: 'Use the main dashboard to change sites. Or drag this reservation to a different site.',
    });
  }

  async cancelReservation(reservation) {
    const ok = await confirmDialog({
      title: 'Cancel Reservation',
      message: `Cancel ${reservation.guestName}'s reservation? This cannot be undone.`,
      confirmLabel: 'Cancel Reservation',
      danger: true,
    });

    if (!ok) return;

    await withLoading(null, async () => {
      const res = await fetch('/api/admin/ops?resource=calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel-reservation',
          reservationId: reservation.id,
        }),
      });

      if (res.ok) {
        await this.loadCalendarData();
        if (this.options.onReservationChange) {
          this.options.onReservationChange();
        }
      } else {
        const err = await res.json();
        alertDialog({ title: 'Error', message: err.error || 'Could not cancel reservation' });
      }
    });
  }

  hideDialog() {
    document.getElementById('calDialog').classList.remove('is-visible');
  }

  drawStats() {
    const siteFilter = document.getElementById('calSiteFilter').value;
    const sites = siteFilter ? this.sites.filter((s) => s.id === siteFilter) : this.sites;

    const stats = {
      occupiedNights: 0,
      totalNights: 0,
      revenue: 0,
      pendingRevenue: 0,
    };

    const dates = this.getVisibleDates();
    sites.forEach((site) => {
      dates.forEach((date) => {
        const dateStr = date.toISOString().split('T')[0];
        const reservation = this.getReservationForCell(site.id, dateStr);

        if (!this.blockedDates.some((b) => b.siteId === site.id && b.date === dateStr)) {
          stats.totalNights++;
        }

        if (reservation) {
          stats.occupiedNights++;
          if (reservation.status === 'pending') {
            stats.pendingRevenue += reservation.totalCents;
          } else {
            stats.revenue += reservation.totalCents;
          }
        }
      });
    });

    const occupancyPercent = stats.totalNights > 0
      ? Math.round((stats.occupiedNights / stats.totalNights) * 100)
      : 0;

    const statsContainer = document.getElementById('calStats');
    statsContainer.innerHTML = `
      <div class="calendar-stat-item">
        <div class="calendar-stat-label">Occupancy</div>
        <div class="calendar-stat-value">${occupancyPercent}%</div>
      </div>
      <div class="calendar-stat-item">
        <div class="calendar-stat-label">Revenue</div>
        <div class="calendar-stat-value">${this.formatUsd(stats.revenue)}</div>
      </div>
      <div class="calendar-stat-item">
        <div class="calendar-stat-label">Pending</div>
        <div class="calendar-stat-value">${this.formatUsd(stats.pendingRevenue)}</div>
      </div>
      <div class="calendar-stat-item">
        <div class="calendar-stat-label">Occupied</div>
        <div class="calendar-stat-value">${stats.occupiedNights} / ${stats.totalNights}</div>
      </div>
    `;
  }

  previousMonth() {
    this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    this.loadCalendarData();
  }

  nextMonth() {
    this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    this.loadCalendarData();
  }

  goToToday() {
    this.currentDate = new Date();
    this.loadCalendarData();
  }

  jumpToMonth(monthStr) {
    const [year, month] = monthStr.split('-');
    this.currentDate = new Date(year, parseInt(month) - 1, 1);
    this.loadCalendarData();
  }

  changeViewMode(mode) {
    this.options.viewMode = mode;
    document.querySelectorAll('.calendar-view-btn').forEach((btn) => {
      btn.classList.remove('is-active');
    });
    document.querySelector(`.calendar-view-btn[data-view="${mode}"]`).classList.add('is-active');
    this.redraw();
  }
}

export { CalendarGrid };
