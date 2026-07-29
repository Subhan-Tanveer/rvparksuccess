import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

const tabs = document.querySelectorAll('.auth-tab');
const panels = document.querySelectorAll('.auth-panel');
const errorEl = document.getElementById('loginError');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('is-active'));
    panels.forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.querySelector(`.auth-panel[data-panel="${tab.dataset.tab}"]`).classList.add('is-active');
    errorEl.classList.remove('is-visible');
  });
});

async function submitAuth(action, body, form) {
  errorEl.classList.remove('is-visible');
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    window.location.href = 'park-dashboard.html';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('is-visible');
    submitBtn.disabled = false;
  }
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth('park-login', {
    username: document.getElementById('username').value,
    password: document.getElementById('password').value,
  }, e.target);
});

document.getElementById('signupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth('owner-signup', {
    parkName: document.getElementById('suParkName').value,
    location: document.getElementById('suLocation').value,
    ownerName: document.getElementById('suOwnerName').value,
    email: document.getElementById('suEmail').value,
    phone: document.getElementById('suPhone').value,
    password: document.getElementById('suPassword').value,
  }, e.target);
});
