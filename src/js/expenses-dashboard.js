// Expenses & Net Operating Income — the missing half of a real income
// and expense report. Revenue was already tracked (every booking is a
// real transaction); this adds real operating expenses with receipts, and
// combines both into Net Operating Income for a period — the number a
// buyer's accountant actually needs when a park owner wants to sell.
import { upload } from '@vercel/blob/client';
import { alertDialog, confirmDialog, withLoading } from './ui-dialogs.js';
import { infoIcon } from './info-icon.js';

let container = null;
let categories = [];
let currentExpenses = [];
let currentPeriod = '30d';

function periodToRange(period) {
  const end = new Date();
  const start = new Date();
  if (period === 'mtd') {
    start.setDate(1);
  } else if (period === 'ytd') {
    start.setMonth(0, 1);
  } else {
    const days = period === '90d' ? 90 : 30;
    start.setDate(start.getDate() - days);
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function formatUsd(cents) {
  const dollars = (cents || 0) / 100;
  return (dollars < 0 ? '-$' : '$') + Math.abs(dollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function initExpensesDashboard(containerId) {
  container = document.getElementById(containerId);
  if (!container) return;
  renderLayout();
  await loadData();
}

function renderLayout() {
  container.innerHTML = `
    <div class="exp-controls">
      <div class="exp-period-selector">
        <button type="button" class="exp-period-btn is-active" data-period="30d">Last 30 days</button>
        <button type="button" class="exp-period-btn" data-period="90d">Last 90 days</button>
        <button type="button" class="exp-period-btn" data-period="mtd">This Month</button>
        <button type="button" class="exp-period-btn" data-period="ytd">Year to Date</button>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="expAddBtn"><span>+ Add Expense</span></button>
    </div>

    <div class="exp-noi-grid">
      <div class="stat-card glass">
        <div class="label">Revenue ${infoIcon('Full price of every confirmed booking (including deposit-only bookings) whose stay falls in this period — not just cash collected so far. This can differ slightly from Advanced Analytics, which counts only the deposit collected for deposit-only bookings.')}</div>
        <div class="value" id="expRevenue">$0</div>
      </div>
      <div class="stat-card glass">
        <div class="label">Expenses ${infoIcon('Total of every expense you’ve recorded for this period, across all categories.')}</div>
        <div class="value" id="expTotal">$0</div>
      </div>
      <div class="stat-card glass">
        <div class="label">Net Operating Income ${infoIcon('Revenue minus expenses for this period — this is the number that actually matters for valuing the park, not revenue alone.')}</div>
        <div class="value" id="expNoi">$0</div>
      </div>
    </div>

    <div class="exp-category-breakdown" id="expCategoryBreakdown"></div>

    <div class="table-scroll">
      <table class="analytics-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Receipt</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="expTableBody">
          <tr><td colspan="6" class="analytics-empty">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('.exp-period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.exp-period-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentPeriod = btn.dataset.period;
      loadData();
    });
  });

  container.querySelector('#expAddBtn').addEventListener('click', openAddExpenseDialog);

  container.querySelector('#expTableBody').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('[data-delete-expense]');
    if (!deleteBtn) return;
    const ok = await confirmDialog({ title: 'Delete this expense?', message: 'This removes it permanently, including its receipt if attached.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await withLoading(deleteBtn, async () => {
      const res = await fetch(`/api/admin/ops?resource=expenses&expenseId=${encodeURIComponent(deleteBtn.dataset.deleteExpense)}`, { method: 'DELETE' });
      if (res.ok) loadData();
      else alertDialog({ title: 'Error', message: (await res.json()).error || 'Could not delete expense' });
    });
  });
}

async function loadData() {
  const { startDate, endDate } = periodToRange(currentPeriod);
  try {
    const res = await fetch(`/api/admin/ops?resource=expenses&startDate=${startDate}&endDate=${endDate}`);
    if (!res.ok) throw new Error('Failed to load expenses');
    const data = await res.json();
    categories = data.categories || [];
    currentExpenses = data.expenses || [];
    renderSummary(data.summary);
    renderTable(currentExpenses);
  } catch (err) {
    console.error('Error loading expenses:', err);
    container.querySelector('#expTableBody').innerHTML = `<tr><td colspan="6" class="analytics-empty">Couldn't load expenses right now.</td></tr>`;
  }
}

function renderSummary(summary) {
  if (!summary) return;
  container.querySelector('#expRevenue').textContent = formatUsd(summary.totalRevenueCents);
  container.querySelector('#expTotal').textContent = formatUsd(summary.totalExpenseCents);
  const noiEl = container.querySelector('#expNoi');
  noiEl.textContent = formatUsd(summary.netOperatingIncomeCents);
  noiEl.style.color = summary.netOperatingIncomeCents >= 0 ? 'var(--amber-light)' : '#f0a89a';

  const breakdown = container.querySelector('#expCategoryBreakdown');
  const entries = Object.entries(summary.expensesByCategory || {}).filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1]);
  breakdown.innerHTML = entries.length
    ? `<h4>Expenses by Category ${infoIcon('How your recorded expenses for this period add up by category. Only categories with at least one expense are shown, ranked highest to lowest.')}</h4><div class="exp-category-rows">${entries.map(([cat, cents]) => `
        <div class="exp-category-row">
          <span class="exp-category-name">${escapeHtml(cat)}</span>
          <span class="exp-category-amount">${formatUsd(cents)}</span>
        </div>`).join('')}</div>`
    : '';
}

function renderTable(expenses) {
  const tbody = container.querySelector('#expTableBody');
  if (!expenses.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="analytics-empty">No expenses recorded for this period yet.</td></tr>';
    return;
  }
  tbody.innerHTML = expenses.map((e) => `
    <tr>
      <td>${e.expenseDate}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.description || '—')}</td>
      <td>${formatUsd(e.amountCents)}</td>
      <td>${e.receiptUrl ? `<a href="${escapeAttr(e.receiptUrl)}" target="_blank" rel="noopener" class="crm-link">View</a>` : '—'}</td>
      <td style="text-align:right;"><button type="button" class="btn btn-ghost btn-sm" data-delete-expense="${escapeAttr(e.id)}">Delete</button></td>
    </tr>`).join('');
}

async function openAddExpenseDialog() {
  // A custom mini-form rather than the generic formDialog helper — this
  // needs a category <select> and an optional file input, which
  // formDialog's field types don't cover.
  const overlay = document.createElement('div');
  overlay.className = 'dlg-backdrop is-open';
  overlay.innerHTML = `
    <div class="dlg-modal is-wide">
      <h3 class="dlg-title">Add Expense</h3>
      <div>
        <form id="expAddForm">
          <div class="field-float"><input id="expDate" type="date" required value="${new Date().toISOString().slice(0, 10)}"><label for="expDate">Date</label></div>
          <div class="field-float">
            <select id="expCategory" required>
              ${categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('')}
            </select>
            <label for="expCategory">Category</label>
          </div>
          <div class="field-float"><input id="expDescription" type="text"><label for="expDescription">Description (optional)</label></div>
          <div class="field-float"><input id="expAmount" type="number" min="0.01" step="0.01" required><label for="expAmount">Amount ($)</label></div>
          <div class="field-float"><input id="expReceipt" type="file" accept="image/*,application/pdf"><label for="expReceipt">Receipt (optional)</label></div>
          <p class="dlg-error" id="expFormError" style="display:none;"></p>
        </form>
      </div>
      <div class="dlg-actions">
        <button type="button" class="btn btn-ghost" id="expCancelBtn">Cancel</button>
        <button type="submit" form="expAddForm" class="btn btn-primary" id="expSubmitBtn"><span>Add Expense</span></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#expCancelBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#expAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector('#expFormError');
    errorEl.style.display = 'none';
    const submitBtn = overlay.querySelector('#expSubmitBtn');

    await withLoading(submitBtn, async () => {
      try {
        const file = overlay.querySelector('#expReceipt').files[0];
        let receiptUrl = null;
        let receiptPathname = null;

        if (file) {
          const blob = await upload(`expenses/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`, file, {
            access: 'public',
            handleUploadUrl: '/api/admin/ops?resource=expenses&action=upload-token',
          });
          receiptUrl = blob.url;
          receiptPathname = blob.pathname;
        }

        const res = await fetch('/api/admin/ops?resource=expenses&action=create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: overlay.querySelector('#expCategory').value,
            description: overlay.querySelector('#expDescription').value,
            amountCents: Math.round(parseFloat(overlay.querySelector('#expAmount').value) * 100),
            expenseDate: overlay.querySelector('#expDate').value,
            receiptUrl, receiptPathname,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not add expense');

        close();
        loadData();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
