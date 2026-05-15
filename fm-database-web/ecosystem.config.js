// Load .env.local so PM2 sees AISENSY_API_KEY, GMAIL_USER, etc.
// dotenv is a Next.js dependency — always present in node_modules.
require("dotenv").config({ path: require("path").join(__dirname, ".env.local") });

module.exports = {
  apps: [
    {
      name: "fm-coach",
      script: "node_modules/.bin/next",
      args: "start --port 3002",
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: 3002,
      },
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      // Scheduled-task sidecar — fires /api/cron/<job> endpoints on cron.
      // Lives in the same PM2 process group so `pm2 reload` restarts both.
      name: "fm-coach-cron",
      script: "scripts/cron-runner.js",
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_URL: "http://localhost:3002",
        // CRON_SECRET must match the value the /api/cron/* routes check.
        // Set in .env.local; required for the route to accept the call.
        CRON_SECRET: process.env.CRON_SECRET || "",
      },
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
