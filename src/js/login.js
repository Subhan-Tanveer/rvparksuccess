import { initCore } from './core.js';

initCore();

let currentRole = 'customer';

// Role tab switching
document.querySelectorAll('.role-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const role = tab.dataset.role;
    currentRole = role;

    // Update active tab
    document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');

    // Update active form
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('is-active'));
    document.getElementById(`${role}Form`).classList.add('is-active');
  });
});

// Auth tab switching (Login/Signup within each role)
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panel = tab.dataset.tab;
    const tabsContainer = tab.closest('.auth-tabs');
    const form = tab.closest('.login-card') || tab.closest('.auth-form').querySelector('.login-card');

    // Update active tab
    tabsContainer.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');

    // Update active panel
    form.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('is-active'));
    form.querySelector(`[data-panel="${panel}"]`).classList.add('is-active');
  });
});

// Customer Login
document.getElementById('customerLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('custLoginEmail').value;
  const password = document.getElementById('custLoginPassword').value;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'customer', action: 'login', email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('userRole', 'customer');
    localStorage.setItem('userEmail', email);
    window.location.href = '/find-a-park.html';
  } catch (err) {
    document.getElementById('custError').textContent = err.message;
    document.getElementById('custError').classList.add('is-visible');
  }
});

// Customer Signup
document.getElementById('customerSignupForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('custSignupName').value;
  const email = document.getElementById('custSignupEmail').value;
  const phone = document.getElementById('custSignupPhone').value;
  const password = document.getElementById('custSignupPassword').value;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'customer', action: 'signup', name, email, phone, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');

    localStorage.setItem('userRole', 'customer');
    localStorage.setItem('userEmail', email);
    window.location.href = '/find-a-park.html';
  } catch (err) {
    document.getElementById('custError').textContent = err.message;
    document.getElementById('custError').classList.add('is-visible');
  }
});

// Owner Login
document.getElementById('ownerLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('ownerLoginEmail').value;
  const password = document.getElementById('ownerLoginPassword').value;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner', action: 'login', email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('userRole', 'owner');
    localStorage.setItem('userEmail', email);
    localStorage.setItem('parkId', data.parkId);
    window.location.href = '/park-owner-dashboard.html';
  } catch (err) {
    document.getElementById('ownerError').textContent = err.message;
    document.getElementById('ownerError').classList.add('is-visible');
  }
});

// Owner Signup
document.getElementById('ownerSignupForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const parkName = document.getElementById('ownerSignupParkName').value;
  const location = document.getElementById('ownerSignupLocation').value;
  const ownerName = document.getElementById('ownerSignupOwnerName').value;
  const email = document.getElementById('ownerSignupEmail').value;
  const phone = document.getElementById('ownerSignupPhone').value;
  const password = document.getElementById('ownerSignupPassword').value;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'owner',
        action: 'signup',
        parkName,
        location,
        ownerName,
        email,
        phone,
        password
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');

    localStorage.setItem('userRole', 'owner');
    localStorage.setItem('userEmail', email);
    localStorage.setItem('parkId', data.parkId);
    window.location.href = '/park-owner-dashboard.html';
  } catch (err) {
    document.getElementById('ownerError').textContent = err.message;
    document.getElementById('ownerError').classList.add('is-visible');
  }
});

// Check if already logged in
const userRole = localStorage.getItem('userRole');
if (userRole === 'customer') {
  window.location.href = '/find-a-park.html';
} else if (userRole === 'owner') {
  window.location.href = '/park-owner-dashboard.html';
}
