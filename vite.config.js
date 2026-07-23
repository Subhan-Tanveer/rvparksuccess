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
      },
    },
  },
});
