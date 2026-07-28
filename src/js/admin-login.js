import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.remove('is-visible');
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/super-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    window.location.href = 'admin-dashboard.html';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('is-visible');
    submitBtn.disabled = false;
  }
});
