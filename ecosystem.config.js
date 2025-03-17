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
        script: './models/zonos-tts/api.py',
        interpreter: 'python3',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '4G',
        env: {
          PORT: 8001,
          DEVICE: 'cuda'
        }
      },
      {
        name: 'latentsync',
        script: './models/latentsync/api.py',
        interpreter: 'python3',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '8G',
        env: {
          PORT: 8002,
          DEVICE: 'cuda'
        }
      }
    ]
  };