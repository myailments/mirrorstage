# Setup Guide

This guide provides detailed instructions for setting up the AI OBS Stream Service, which is designed specifically for integration with OBS Studio for livestreaming.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** (v7 or higher)
- **Python** (v3.10 or higher, for local services)
- **ffmpeg** (for video processing)
- **OBS Studio** (v28 or higher with WebSocket plugin enabled)
- **Git** (for cloning the repository)

## Required Media Files

Before setting up the service, you'll need to prepare the following media files:

### Base Video
You'll need a 10-20 second video file to use as the base video loop. This should be:
- A clean, loopable video of the character/avatar you want to animate
- Preferably MP4 format with H.264 encoding
- Recommended resolution of 1280x720 or 1920x1080
- The person/character in the video should be looking at the camera and relatively still
- Place this file in the `assets/` directory as `base_video.mp4`

### Base Audio
You'll also need a sample audio file that represents the voice you want to use:
- A clear recording of the voice you want to synthesize
- WAV format, 16-bit PCM, 44.1kHz
- 3-10 seconds in length
- Good audio quality with minimal background noise
- Place this file in the `assets/` directory as `base_audio.wav`

These files are essential for the service to function properly. The base video serves as the foundation that will be animated with lip sync, and the base audio helps voice-cloning models generate speech with similar characteristics.

## Basic Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/stream-service.git
cd stream-service
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Create Environment Configuration

```bash
cp .env.example .env
```

Then edit the `.env` file with your preferred text editor to configure the service.

### 4. Run the Setup Script

This will create necessary directories and set up any required local services:

```bash
npm run setup
```

### 5. Start the Service

For development with auto-reload:

```bash
npm run dev
```

For production:

```bash
npm run build
npm start
```

## Configuration Options

The `.env` file contains all configurable options. Here are the key categories:

### Server Configuration

```
PORT=3000
HOST=0.0.0.0
BASE_URL=http://localhost:3000
```

### Service Selection

Choose which implementation to use for each component:

```
# LLM Service (OPENAI, OPENROUTER, CLOUDY)
USE_OPENAI=true
USE_OPENROUTER=false
USE_CLOUDY_API=false

# TTS Service (ZONOS_LOCAL, ZONOS_API, ELEVENLABS)
USE_ZONOS_TTS_LOCAL=true
USE_ZONOS_TTS_API=false
USE_ELEVENLABS=false

# Video Sync Service (LOCAL, FAL, SYNC_LABS)
USE_LOCAL_LATENT_SYNC=true
USE_FAL_LATENT_SYNC=false
USE_SYNC_LABS=false

# Media Stream Service (CLIENT, OBS)
USE_OBS=false
```

### API Keys

Add your API keys for any external services:

```
# OpenAI
OPENAI_API_KEY=your_openai_api_key

# OpenRouter
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_GENERATION_MODEL=deepseek/deepseek-chat-v3-0324:free
OPENROUTER_EVALUATION_MODEL=openai/gpt-4o-mini
OPENROUTER_SITE_URL=your_site_url
OPENROUTER_SITE_NAME=your_site_name

# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_voice_id

# Zonos API
ZONOS_API_KEY=your_zonos_api_key

# FAL.ai
FAL_KEY=your_fal_api_key

# Sync Labs
SYNC_LABS_KEY=your_sync_labs_key

# AWS (for S3 storage with Sync Labs)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_BUCKET_NAME=your_bucket_name

# Supabase (optional)
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### File Paths

```
BASE_VIDEO_PATH=./assets/base_video.mp4
OUTPUT_DIR=./generated_videos
BASE_AUDIO_PATH=./assets/base_audio.wav
```

### Pipeline Configuration

```
MIN_QUEUE_SIZE=3
MAX_QUEUE_SIZE=10
MAX_CONCURRENT=4
MIN_PRIORITY=0.5
```

### OBS Configuration

```
OBS_WEBSOCKET_HOST=localhost
OBS_WEBSOCKET_PORT=4455
OBS_WEBSOCKET_PASSWORD=your_password
OBS_BASE_SCENE=Base Scene
OBS_GENERATED_SCENE=Generated Scene
OBS_GENERATED_SOURCE=Generated Video
```

### Vision Configuration

```
USE_VISION=false
VISION_SOURCE_NAME=Display Capture
VISION_INTERVAL_SECONDS=30
VISION_PROMPT=You are analyzing a livestream. What is happening in this image?
```

## Setting Up Local Services

### Zonos TTS (Local)

The local TTS service is installed automatically by the setup script, but you can also install it manually:

```bash
./scripts/setup_zonos.sh
```

This will:
1. Create a Python virtual environment
2. Install required dependencies
3. Download necessary models
4. Set up the service to run on port 8001

### LatentSync (Local)

The local lip sync service is also installed automatically, but you can manually set it up:

```bash
./scripts/setup_latentsync.sh
```

This will:
1. Create a Python virtual environment
2. Install required dependencies
3. Download necessary models
4. Set up the service to run on port 8002

## OBS Integration

If you want to use OBS for streaming:

1. Install OBS Studio 28.0.0 or higher
2. Enable the WebSocket server in OBS (Tools > WebSocket Server Settings)
3. Set `USE_OBS=true` in your `.env` file
4. Configure the OBS settings in your `.env` file
5. See [OBS_SETUP.md](../OBS_SETUP.md) for detailed instructions

## Troubleshooting

### Common Issues

#### Cannot connect to local services

- Ensure the setup scripts completed successfully
- Check if the services are running (they should start automatically)
- Verify the ports (8001 for TTS, 8002 for LatentSync) are not blocked or in use

#### OBS connection fails

- Ensure OBS is running and the WebSocket server is enabled
- Check that the WebSocket port and password match your `.env` settings
- OBS must be version 28.0.0 or higher with the WebSocket plugin

#### Video generation fails

- Check that ffmpeg is installed and in your PATH
- Ensure the output directory exists and is writable
- Check that your base video and audio files exist at the configured paths

#### LLM API errors

- Verify your API keys are correct
- Check your network connection
- Some models might have rate limits or quotas

### Logs

Log files are stored in the `logs` directory and can help diagnose issues.

## Running in Production

For production deployments:

1. Build the application:
   ```bash
   npm run build
   ```

2. Set appropriate environment variables for your production environment

3. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start ecosystem.config.cjs
   ```

4. Set up a reverse proxy (Nginx, Apache, etc.) to handle TLS termination and other web server functions

## Updating

To update the service:

1. Pull the latest changes:
   ```bash
   git pull
   ```

2. Install any new dependencies:
   ```bash
   npm install
   ```

3. Run the setup script to update local services:
   ```bash
   npm run setup
   ```

4. Rebuild the application:
   ```bash
   npm run build
   ```

5. Restart the service