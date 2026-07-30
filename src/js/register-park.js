import '../css/tokens.css';
import { initCore } from './core.js';

initCore();

async function checkState() {
  const res = await fetch('/api/admin/dashboard');
  if (res.status === 401) {
    window.location.href = 'login.html';
    return;
  }
  const data = await res.json();
  if (!data.park.planKey) {
    window.location.href = 'packages.html';
    return;
  }
  if (data.park.name) {
    window.location.href = 'park-dashboard.html';
    return;
  }

  document.getElementById('gate').style.display = 'block';
  if (new URLSearchParams(location.search).get('checkout') === 'success') {
    document.getElementById('paymentBanner').classList.add('is-visible');
  }
}

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('registerError');
  const btn = document.getElementById('registerBtn');
  errorEl.classList.remove('is-visible');
  btn.disabled = true;

  try {
    const res = await fetch('/api/admin/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: 'register-park',
        parkName: document.getElementById('rpName').value,
        location: document.getElementById('rpLocation').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not register your park');
    window.location.href = 'park-dashboard.html';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('is-visible');
    btn.disabled = false;
  }
});

checkState();
