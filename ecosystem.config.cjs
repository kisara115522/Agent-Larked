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
        DB_PATH: path.join(ROOT, 'data/agentfeed.db'),
        // Set to require runtime registration auth:
        // RUNTIME_REGISTRATION_SECRET: 'your-secret-here',
      },
    },
    {
      name: 'flock-web',
      script: 'npx',
      args: 'vite preview --port 5174 --host 0.0.0.0',
      cwd: path.join(ROOT, 'packages/web'),
    },
    {
      name: 'flock-runtime',
      script: path.join(ROOT, 'packages/runtime/dist/index.js'),
      cwd: ROOT,
      env: {
        FLOCK_SERVER_URL: 'http://localhost:3001',
        // Must match server's RUNTIME_REGISTRATION_SECRET if set:
        // RUNTIME_REGISTRATION_SECRET: 'your-secret-here',
      },
    },
  ],
};
