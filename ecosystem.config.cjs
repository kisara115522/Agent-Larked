const path = require('path');
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'flock-server',
      script: path.join(ROOT, 'packages/server/dist/index.js'),
      cwd: ROOT,
      env: {
        PORT: '3001',
        HOST: 'localhost',
        SERVER_RUN: '1',
        DB_PATH: path.join(ROOT, 'data/agentfeed.db'),
        // Set to require runtime registration auth:
        // RUNTIME_REGISTRATION_SECRET: 'your-secret-here',
      },
    },
    {
      name: 'flock-web',
      script: 'npx',
      args: 'vite preview --port 5174',
      cwd: path.join(ROOT, 'packages/web'),
    },
    {
      name: 'flock-runtime',
      script: path.join(ROOT, 'packages/runtime/dist/index.js'),
      cwd: ROOT,
      env: {
        FLOCK_SERVER_URL: 'http://localhost:3001',
        HOST: 'localhost',
        // Must match server's RUNTIME_REGISTRATION_SECRET if set:
        // RUNTIME_REGISTRATION_SECRET: 'your-secret-here',
      },
    },
  ],
};
