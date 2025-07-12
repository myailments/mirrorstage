# mirrorstage

mirrorstage is a one-shot AI livestreaming platform that creates automated talking head videos in response to user input or chat messages.

## features

- **modular service architecture** - swap between different LLM, TTS, and video sync providers
- **real-time chat ingestion** - automatically responds to pump.fun chat messages
- **obs integration** - seamless streaming with dynamic video switching
- **concurrent processing** - handles multiple requests with configurable queue limits
- **vision analysis** - can analyze screenshots from obs (currently disabled)
- **character customization** - define custom AI personalities and prompts

## supported services

### text generation (llm)

- openai
- openrouter
- cloudyapi

### text-to-speech (tts)

- zonos (local/api)
- elevenlabs

### video synchronization

- latentsync (local)
- fal api (latentsync/pixverse)
- sync labs

## how to use

1. clone this repo

2. install dependencies

   ```bash
   npm install
   # or
   yarn install
   ```

3. set up assets

   - add `base_video.mp4` to `_assets/` (30 seconds, front-facing human, minimal movement)
   - add `base_audio.wav` to `_assets/` (voice sample for tts reference)

4. configure character

   - edit `server/prompts/character-file.ts` to define your AI personality

5. set up environment

   ```bash
   cp .env.example .env
   # edit .env with your api keys and configuration
   ```

6. configure obs

   - install obs studio
   - enable websocket server in obs (tools → websocket server settings)
   - default port: 4455
   - set password if desired (update in .env)

7. run the service
   ```bash
   npm run dev
   # or for production
   npm run build && npm start
   ```

## configuration

key environment variables:

```bash
# service selection
TEXT_GENERATION_SERVICE=openai  # openai, openrouter, cloudyapi
TTS_SERVICE=zonos               # zonos, elevenlabs
VIDEO_SERVICE=fal               # local, fal, synclabs

# api keys
OPENAI_API_KEY=your-key
ELEVENLABS_API_KEY=your-key
FAL_KEY=your-key
SYNC_LABS_API_KEY=your-key

# obs configuration
OBS_WEBSOCKET_URL=ws://localhost:4455
OBS_WEBSOCKET_PASSWORD=your-password

# file paths
BASE_VIDEO_PATH=./_assets/base_video.mp4
BASE_AUDIO_PATH=./_assets/base_audio.wav
OUTPUT_DIR=./_outputs

# processing settings
PIPELINE_CONCURRENT_LIMIT=2
MAX_QUEUE_SIZE=10
```

## usage modes

### cli mode

```bash
npm run dev
# type messages directly to test the pipeline
```

### chat ingestion mode

```bash
# set PUMP_FUN_URL in .env
# the service will automatically monitor pump.fun chat
```

## architecture

```
input sources → evaluation → text generation → tts → video sync → obs stream
     ↓              ↓             ↓              ↓         ↓           ↓
  cli/chat    priority filter   llm api      audio     talking    broadcast
                               response    generation    head
```

## development

### project structure

```
mirrorstage/
├── server/
│   ├── app.ts              # main pipeline orchestrator
│   ├── config.ts           # configuration management
│   ├── services/           # modular service implementations
│   │   ├── interfaces.ts   # service interfaces
│   │   ├── OBSStream.ts    # obs integration
│   │   ├── PipelineInitializer.ts
│   │   └── ...
│   ├── prompts/            # ai prompts and character definitions
│   └── utils/              # utilities and helpers
├── _assets/                # base video/audio files
├── _outputs/               # generated content
└── package.json
```

### adding new services

1. implement the appropriate interface from `server/services/interfaces.ts`
2. add service initialization in `PipelineInitializer.ts`
3. update environment configuration in `config.ts`

### linting

```bash
npm run lint
```

## troubleshooting

### obs connection issues

- ensure obs websocket server is enabled
- check port and password match your .env settings
- verify obs is running before starting the service

### video generation failures

- check api keys are valid
- ensure base video/audio files exist
- verify output directory has write permissions
