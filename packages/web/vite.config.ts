import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PREFIXES = ['/agents', '/rooms', '/messages', '/broadcast', '/feed', '/events', '/invites', '/auth', '/direct-chats', '/admin', '/tasks'];

function isApiRequest(req: { headers: Record<string, string | undefined>; url?: string }): boolean {
  // API calls carry Authorization header (fetch from client.ts)
  if (req.headers.authorization) return true;
  // POST/PUT/DELETE with JSON body
  if (req.headers['content-type']?.includes('application/json')) return true;
  // SSE EventSource passes token via query param
  if (req.url?.includes('token=')) return true;
  return false;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map(prefix => [
        prefix,
        {
          target: 'http://localhost:3000',
          // Only proxy genuine API requests. Browser page-refresh navigations
          // lack auth headers, so they skip the proxy and hit Vite's SPA fallback.
          bypass(req) {
            if (!isApiRequest(req)) {
              return req.url;
            }
          },
        },
      ]),
    ),
  },
});
