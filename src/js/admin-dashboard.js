import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

const gate = document.getElementById('gate');
const tbody = document.getElementById('parksTableBody');
const emptyEl = document.getElementById('parksEmpty');

async function loadParks() {
  const res = await fetch('/api/admin/parks');
  if (res.status === 401) {
    window.location.href = 'admin-login.html';
    return;
  }
  const data = await res.json();
  gate.style.display = 'block';
  renderParks(data.parks || []);
}

function renderParks(parks) {
  if (!parks.length) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  tbody.innerHTML = parks.map((p) => `
    <tr>
      <td>${p.name}</td>
      <td>${p.location}</td>
      <td><code>${p.staffUsername}</code></td>
      <td>${p.siteCount}</td>
      <td>${new Date(p.createdAt).toLocaleDateString()}</td>
    </tr>`).join('');
}

const createForm = document.getElementById('createParkForm');
const createBtn = document.getElementById('createParkBtn');
const createAlert = document.getElementById('createParkAlert');

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createAlert.classList.remove('is-visible', 'is-success', 'is-error');
  createBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/parks', {
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

    createAlert.textContent = `${data.park.name} created — give the staff login "${data.park.staffUsername}" and the password you set to their team, and send them to park-login.html.`;
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
