import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/agents': 'http://localhost:3000',
      '/rooms': 'http://localhost:3000',
      '/messages': 'http://localhost:3000',
      '/broadcast': 'http://localhost:3000',
      '/feed': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/invites': 'http://localhost:3000',
    },
  },
});
