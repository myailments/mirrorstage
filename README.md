# mirrorstage

mirrorstage is a one-shot AI livestreaming service

## features

- **unified AI pipeline** - Inworld AI handles both text generation and TTS in a single optimized flow
- **real-time chat ingestion** - automatically responds to pump.fun chat messages
- **OBS integration** - seamless streaming with dynamic video switching
- **concurrent processing** - handles multiple requests with configurable queue limits
- **character customization** - define custom AI personalities and prompts
- **lip-sync video generation** - FAL API creates talking head videos from audio

## architecture

```
input → evaluation → Inworld AI (LLM + TTS) → FAL video sync → OBS stream
  ↓         ↓              ↓                       ↓              ↓
cli/chat  priority     text + audio            talking head   broadcast
          filter       generation              video
```

The pipeline uses:

- **Inworld AI Runtime SDK** - Graph-based LLM + TTS pipeline
- **FAL LatentSync** - Audio-driven lip-sync video generation
- **OBS WebSocket** - Live stream control and video switching

## quick start

1. **Clone and install**

   ```bash
   git clone <repo-url>
   cd stream-service
   npm install
   ```

2. **Set up assets**

   Add a base video to `assets/base_video.mp4`:

   - 30 seconds recommended
   - Front-facing human subject
   - Minimal head movement
   - Good lighting

3. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your API keys:

   ```bash
   # Required
   INWORLD_API_KEY=your-inworld-api-key
   FAL_KEY=your-fal-api-key

   # Optional - Inworld voice (default: Dennis)
   INWORLD_VOICE_ID=Dennis

   # OBS WebSocket
   OBS_WEBSOCKET_HOST=localhost
   OBS_WEBSOCKET_PORT=4455
   OBS_WEBSOCKET_PASSWORD=your-password
   ```

4. **Configure OBS**

   - Install OBS Studio
   - Enable WebSocket server: Tools → WebSocket Server Settings
   - Default port: 4455
   - Set password if desired

5. **Customize character**

   Edit `server/prompts/character-file.ts` to define your AI personality.

6. **Run**

   ```bash
   # Development
   npm run dev

   # CLI mode (for testing)
   npm run cli:dev

   # Test mode (skip video sync)
   TEST_MODE=true npm run cli:dev

   # Production
   npm run build && npm start
   ```

## configuration

### environment variables

```bash
# Inworld AI
INWORLD_API_KEY=           # Required - Inworld API key
INWORLD_VOICE_ID=Dennis    # Optional - Voice for TTS

# FAL API
FAL_KEY=                   # Required - FAL API key for video sync

# OBS WebSocket
OBS_WEBSOCKET_HOST=localhost
OBS_WEBSOCKET_PORT=4455
OBS_WEBSOCKET_PASSWORD=

# File paths
BASE_VIDEO_PATH=./assets/base_video.mp4
OUTPUT_DIR=./generated_videos

# Processing
MAX_CONCURRENT=10
MIN_QUEUE_SIZE=3
MAX_QUEUE_SIZE=10
MIN_PRIORITY=3             # Messages below this priority are rejected

# Chat ingestion (optional)
USE_PUMP_FUN=false
PUMP_FUN_URL=

# Testing
TEST_MODE=false            # Skip video sync and OBS
```

### message priority

Messages are evaluated and assigned a priority score (0-10):

- Questions (`?`) → priority 8
- Engagement keywords (hey, hi, what, how, etc.) → priority 7
- Short messages (<5 chars) → priority 2
- Default → priority 5

Messages below `MIN_PRIORITY` are rejected.

## usage modes

### CLI mode

```bash
npm run cli:dev
```

Type messages directly to test the pipeline without chat ingestion.

### Test mode

```bash
TEST_MODE=true npm run cli:dev
```

Skips video sync and OBS - useful for testing Inworld AI responses.

### Chat ingestion

```bash
# In .env
USE_PUMP_FUN=true
PUMP_FUN_URL=https://pump.fun/coin/your-token
```

Automatically monitors pump.fun chat and responds to messages.

## project structure

```
stream-service/
├── server/
│   ├── app.ts                    # Main pipeline orchestrator
│   ├── config.ts                 # Configuration management
│   ├── services/
│   │   ├── InworldService.ts     # Unified LLM + TTS via Inworld AI
│   │   ├── VideoSync.ts          # FAL LatentSync video generation
│   │   ├── OBSStream.ts          # OBS WebSocket integration
│   │   ├── PipelineInitializer.ts
│   │   ├── PumpFunMessages.ts    # Chat ingestion
│   │   ├── FileManager.ts        # File I/O utilities
│   │   └── interfaces.ts         # Service interfaces
│   ├── prompts/
│   │   ├── character-file.ts     # AI personality definition
│   │   └── system-prompt.ts      # System prompt builder
│   ├── types/
│   │   └── index.ts              # TypeScript types
│   └── utils/
│       ├── logger.ts             # Logging utility
│       └── strings.ts            # String helpers
├── assets/                       # Base video files
├── generated_videos/             # Output directory
└── package.json
```

## development

### commands

```bash
npm run dev          # Development server with hot reload
npm run cli:dev      # CLI mode for testing
npm run build        # Build for production
npm run start        # Run production build
npm run typecheck    # TypeScript type checking
npm run lint         # Run Biome linter
```

### adding custom voices

Inworld AI supports various voices. Set `INWORLD_VOICE_ID` in your `.env`:

```bash
INWORLD_VOICE_ID=Dennis    # Default male voice
INWORLD_VOICE_ID=Rachel    # Female voice
# See Inworld TTS Playground for more options
```

## troubleshooting

### Inworld authentication errors

- Verify `INWORLD_API_KEY` is set correctly
- Run `npx inworld login` to authenticate via browser
- Check your Inworld dashboard for API key status

### OBS connection issues

- Ensure OBS WebSocket server is enabled
- Verify port and password match your `.env` settings
- Start OBS before running the service

### Video generation failures

- Check FAL API key is valid
- Ensure base video exists at configured path
- Verify output directory has write permissions

### Audio issues

- Inworld TTS returns 32-bit IEEE 754 float audio at 48kHz
- Audio is automatically converted to WAV format
- Check `INWORLD_VOICE_ID` for voice availability

## license

MIT
