import { initCore } from './core.js';

initCore();

// Auth tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panel = tab.dataset.tab;
    const tabsContainer = tab.closest('.auth-tabs');

    tabsContainer.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');

    document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('is-active'));
    document.querySelector(`[data-panel="${panel}"]`).classList.add('is-active');
  });
});

// TODO: Wire up login/signup forms to API
