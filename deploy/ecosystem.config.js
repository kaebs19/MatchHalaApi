// PM2 Ecosystem Configuration for HalaChat
module.exports = {
    apps: [
        {
            name: 'halachat-api',
            script: './backend/server.js',
            cwd: '/var/www/HalaChat',
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production',
                PORT: 5001
            },
            error_file: '/var/log/halachat/api-error.log',
            out_file: '/var/log/halachat/api-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000
        }
    ]
};
