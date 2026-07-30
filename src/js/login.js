import '../css/tokens.css';
import { initCore } from './core.js';
import { markGuestLoggedIn } from './guest-session.js';

initCore();

const errorEl = document.getElementById('loginError');

if (new URLSearchParams(location.search).get('reason') === 'idle') {
  errorEl.textContent = 'You were logged out after 24 hours of inactivity — log back in to continue.';
  errorEl.classList.add('is-visible', 'is-info');
}

/* -- role switch (RVPark Owner / Simple User) -- */
document.querySelectorAll('[data-role-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-role-tab]').forEach((t) => t.classList.remove('is-active'));
    document.querySelectorAll('[data-role-panel]').forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.querySelector(`[data-role-panel="${tab.dataset.roleTab}"]`).classList.add('is-active');
    errorEl.classList.remove('is-visible', 'is-info');
  });
});

/* -- Log In / Sign Up sub-tabs, scoped per role -- */
function wireSubTabs(prefix) {
  document.querySelectorAll(`[data-${prefix}-tab]`).forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll(`[data-${prefix}-tab]`).forEach((t) => t.classList.remove('is-active'));
      document.querySelectorAll(`[data-${prefix}-panel]`).forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.querySelector(`[data-${prefix}-panel="${tab.dataset[`${prefix}Tab`]}"]`).classList.add('is-active');
      errorEl.classList.remove('is-visible', 'is-info');
    });
  });
}
wireSubTabs('owner');
wireSubTabs('user');

async function submitAuth(url, body, form, onSuccess) {
  errorEl.classList.remove('is-visible', 'is-info');
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    onSuccess(data);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('is-visible');
    submitBtn.disabled = false;
  }
}

/* -- RVPark Owner: log in / sign up -- */
document.getElementById('ownerLoginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth('/api/admin/auth', {
    action: 'park-login',
    username: document.getElementById('ownerLoginEmail').value,
    password: document.getElementById('ownerLoginPassword').value,
  }, e.target, (data) => { window.location.href = data.redirectTo || 'park-dashboard.html'; });
});

document.getElementById('ownerSignupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth('/api/admin/auth', {
    action: 'owner-signup',
    ownerName: document.getElementById('ownerSuName').value,
    email: document.getElementById('ownerSuEmail').value,
    phone: document.getElementById('ownerSuPhone').value,
    password: document.getElementById('ownerSuPassword').value,
  }, e.target, (data) => { window.location.href = data.redirectTo || 'packages.html'; });
});

/* -- Simple User: log in / sign up -- */
document.getElementById('userLoginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth('/api/guest', {
    action: 'login',
    email: document.getElementById('userLoginEmail').value,
    password: document.getElementById('userLoginPassword').value,
  }, e.target, () => { markGuestLoggedIn(); window.location.href = 'find-a-park.html'; });
});

document.getElementById('userSignupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAuth('/api/guest', {
    action: 'signup',
    name: document.getElementById('userSuName').value,
    email: document.getElementById('userSuEmail').value,
    phone: document.getElementById('userSuPhone').value,
    password: document.getElementById('userSuPassword').value,
  }, e.target, () => { markGuestLoggedIn(); window.location.href = 'find-a-park.html'; });
});
