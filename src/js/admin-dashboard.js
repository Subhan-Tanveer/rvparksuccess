import '../css/tokens.css';
import { initCore } from './core.js';
import { PACKAGES } from './services-data.js';
import { alertDialog } from './ui-dialogs.js';

initCore();

const gate = document.getElementById('gate');
const tbody = document.getElementById('parksTableBody');
const emptyEl = document.getElementById('parksEmpty');

// GHL CRM access is only sold as part of Growth/Maximum — Foundation and
// the bare Website & Booking add-on don't include it.
const CRM_ELIGIBLE_PLAN_KEYS = ['growth', 'maximum'];

async function loadParks() {
  const res = await fetch('/api/admin/ops?resource=parks');
  if (res.status === 401) {
    window.location.href = 'admin-login.html';
    return;
  }
  const data = await res.json();
  gate.style.display = 'block';
  renderParks(data.parks || []);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function renderParks(parks) {
  if (!parks.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = parks.map((p) => {
    const plan = PACKAGES.find((pkg) => pkg.key === p.planKey);
    const crmEligible = CRM_ELIGIBLE_PLAN_KEYS.includes(p.planKey);
    const crmCell = crmEligible
      ? `<div style="display:flex; gap:6px; align-items:center;">
           <input type="url" class="crm-url-input" data-park-id="${p.id}" value="${escapeHtml(p.ghlCrmUrl || '')}" placeholder="https://..." style="min-width:180px; padding:6px 8px; border-radius:6px; border:1px solid var(--border-glass); background:transparent; color:var(--cream); font-size:0.8125rem;">
           <button type="button" class="btn btn-ghost btn-sm crm-url-save" data-park-id="${p.id}">Save</button>
         </div>`
      : '<span style="color:var(--cream-dim);">—</span>';

    return `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.location)}</td>
      <td><code>${escapeHtml(p.staffUsername)}</code></td>
      <td>${plan ? escapeHtml(plan.name) : '<span style="color:var(--cream-dim);">None</span>'}</td>
      <td>${p.siteCount}</td>
      <td>${new Date(p.createdAt).toLocaleDateString()}</td>
      <td>${crmCell}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.crm-url-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const parkId = btn.dataset.parkId;
      const input = tbody.querySelector(`.crm-url-input[data-park-id="${parkId}"]`);
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/ops?resource=parks', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parkId, ghlCrmUrl: input.value.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not save CRM URL');
        await alertDialog({ title: 'Saved', message: 'CRM URL updated — the park owner will see it next time they open their dashboard.' });
      } catch (err) {
        await alertDialog({ title: 'Error', message: err.message });
      } finally {
        btn.disabled = false;
      }
    });
  });
}

const createForm = document.getElementById('createParkForm');
const createBtn = document.getElementById('createParkBtn');
const createAlert = document.getElementById('createParkAlert');

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createAlert.classList.remove('is-visible', 'is-success', 'is-error');
  createBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/ops?resource=parks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('pName').value,
        location: document.getElementById('pLocation').value,
        staffUsername: document.getElementById('pUsername').value,
        staffPassword: document.getElementById('pPassword').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create park');

    createAlert.textContent = `${data.park.name} created — give the staff login "${data.park.staffUsername}" and the password you set to their team, and send them to login.html (RVPark Owner tab).`;
    createAlert.classList.add('is-visible', 'is-success');
    createForm.reset();
    loadParks();
  } catch (err) {
    createAlert.textContent = err.message;
    createAlert.classList.add('is-visible', 'is-error');
  } finally {
    createBtn.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
  window.location.href = 'admin-login.html';
});

loadParks();
