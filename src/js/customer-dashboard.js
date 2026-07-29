import { initCore } from './core.js';

initCore();

// Load customer bookings
async function loadDashboard() {
  const userRole = localStorage.getItem('userRole');
  if (userRole !== 'customer') {
    window.location.href = '/login.html';
    return;
  }

  // TODO: Fetch customer bookings from API
  document.getElementById('gate').style.display = 'block';
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('userRole');
  localStorage.removeItem('userEmail');
  window.location.href = '/login.html';
});

loadDashboard();
