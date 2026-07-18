module.exports = {
  apps: [
    {
      name: 'matchhala-api',
      script: 'server.js',
      instances: 4,
      exec_mode: 'cluster',
      // ✅ 2026-07-18: رفع الحد من 400M — كان يسبب إعادة تشغيل كل 1-2 دقيقة
      //    (ردود مقطوعة → decode_failure عند المستخدمين). السيرفر فيه 47GB.
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=1024',
      env: {
        NODE_ENV: 'production'
      },
      // إعادة تشغيل تلقائي عند تسرب ذاكرة
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100
    },
    {
      // ✅ كرون لإلغاء الاشتراكات المنتهية تلقائياً — يشتغل كل ساعة
      name: 'matchhala-expire-premium',
      script: 'scripts/expirePremiumSubscriptions.js',
      cron_restart: '0 * * * *', // كل ساعة عند الدقيقة 0
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      // ✅ كرون لتصحيح isOnline=true الـ stale — يشتغل كل 5 دقائق
      // لو lastLogin > 15 دقيقة → isOnline=false
      name: 'matchhala-cleanup-stale-online',
      script: 'scripts/cleanupStaleOnline.js',
      cron_restart: '*/5 * * * *', // كل 5 دقائق
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
