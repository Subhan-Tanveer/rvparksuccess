import { initCore } from './core.js';

initCore();

// Load park owner dashboard
async function loadDashboard() {
  const userRole = localStorage.getItem('userRole');
  if (userRole !== 'owner') {
    window.location.href = '/login.html';
    return;
  }

  // TODO: Fetch park info and sites from API
  document.getElementById('gate').style.display = 'block';
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('userRole');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('parkId');
  window.location.href = '/login.html';
});

loadDashboard();
