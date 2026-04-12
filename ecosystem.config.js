module.exports = {
  apps: [{
    name: 'matchhala-api',
    script: 'server.js',
    max_memory_restart: '400M',
    node_args: '--max-old-space-size=512',
    env: {
      NODE_ENV: 'production'
    },
    // إعادة تشغيل تلقائي عند تسرب ذاكرة
    max_restarts: 50,
    min_uptime: '10s',
    restart_delay: 3000,
    exp_backoff_restart_delay: 100
  }]
};
