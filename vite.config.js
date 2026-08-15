import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5195, strictPort: true },
  preview: { port: 5195 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        packages: resolve(__dirname, 'packages.html'),
        howItWorks: resolve(__dirname, 'how-it-works.html'),
        results: resolve(__dirname, 'results.html'),
        contact: resolve(__dirname, 'contact.html'),
        sample: resolve(__dirname, 'sample.html'),
        reservations: resolve(__dirname, 'reservations.html'),
        findAPark: resolve(__dirname, 'find-a-park.html'),
        login: resolve(__dirname, 'login.html'),
        registerPark: resolve(__dirname, 'register-park.html'),
        guestDashboard: resolve(__dirname, 'guest-dashboard.html'),
        adminLogin: resolve(__dirname, 'admin-login.html'),
        adminDashboard: resolve(__dirname, 'admin-dashboard.html'),
        parkDashboard: resolve(__dirname, 'park-dashboard.html'),
        calendarGrid: resolve(__dirname, 'calendar-grid.html'),
        portfolioDashboard: resolve(__dirname, 'portfolio-dashboard.html'),
      },
    },
  },
});
