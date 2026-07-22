import '../css/tokens.css';
import { initCore, initHeroVideo } from './core.js';

initCore();
initHeroVideo({ placeholderLabel: 'CONTACT — HERO VIDEO COMING SOON' });

const form = document.getElementById('auditForm');
const success = document.getElementById('auditSuccess');
const submitBtn = form.querySelector('button[type="submit"]');

function mailtoFallback(data) {
  const subject = encodeURIComponent(`Free Audit Request: ${data.park}`);
  const body = encodeURIComponent(
    `Name: ${data.name}\nPark Name: ${data.park}\nLocation: ${data.location}\nCurrent Occupancy: ${data.occupancy}%\nPhone: ${data.phone}\nEmail: ${data.email}`
  );
  window.location.href = `mailto:marie@rvparksales.com?subject=${subject}&body=${body}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  try {
    const res = await fetch('/api/send-audit-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('email send failed');
    success.textContent = "Thanks — we've emailed you a confirmation and will be in touch within one business day.";
    success.classList.add('is-visible');
    form.reset();
  } catch (err) {
    // Most likely cause in local dev: /api routes only run under `vercel dev` or once deployed to Vercel.
    console.warn('Live email send unavailable, falling back to mailto:', err.message);
    mailtoFallback(data);
    success.textContent = 'Thanks — your email client should have opened with this request ready to send.';
    success.classList.add('is-visible');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});
