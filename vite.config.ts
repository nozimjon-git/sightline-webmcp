import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * WebMCP refuses to register tools unless the document lives in an origin-keyed
 * agent cluster (spec: registerTool() rejects with SecurityError when the agent
 * cluster's "is origin-keyed" is false). Chrome only origin-keys a document when
 * it is served with `Origin-Agent-Cluster: ?1`, so we set it for dev, preview and
 * production (see public/_headers + netlify.toml) alike.
 */
const originIsolation = { 'Origin-Agent-Cluster': '?1' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: originIsolation },
  preview: { headers: originIsolation },
  build: { target: 'es2022' },
});
