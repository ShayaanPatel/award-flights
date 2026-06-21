import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy Socket.io connections to the backend during dev
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
      // Proxy health/metrics endpoints for the status bar
      '/health': 'http://localhost:4000',
      '/metrics': 'http://localhost:4000',
    },
  },
});
