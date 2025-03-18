module.exports = {
    apps: [
      {
        name: 'stream-service',
        script: 'server/app.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
          NODE_ENV: 'production',
          PORT: 3000
        }
      },
      {
        name: 'zonos-tts',
        cwd: './models/zonos-tts',
        script: './start_server.sh',
        env: {
          FLASK_APP: 'server.py',
          FLASK_ENV: 'production',
          GUNICORN_TIMEOUT: '300'  // 5 minutes timeout
        },
        watch: false,
        autorestart: true
      },
      {
        name: 'latentsync',
        cwd: './models/latentsync',
        script: './start_server.sh',
        env: {
          FLASK_APP: 'server.py',
          FLASK_ENV: 'production',
          GUNICORN_TIMEOUT: '300'  // 5 minutes timeout
        },
        watch: false,
        autorestart: true
      }
    ]
  };