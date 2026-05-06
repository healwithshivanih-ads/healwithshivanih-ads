module.exports = {
  apps: [
    {
      name: "fm-coach",
      script: "node_modules/.bin/next",
      args: "start --port 3002",
      cwd: "/Users/shivani/code/healwithshivanih-ads/fm-database-web",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
      },
      // Restart if it crashes, but not in a loop
      max_restarts: 10,
      restart_delay: 3000,
      // Log output
      out_file: "/Users/shivani/.pm2/logs/fm-coach-out.log",
      error_file: "/Users/shivani/.pm2/logs/fm-coach-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
