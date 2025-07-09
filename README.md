# AI OBS Stream Service

An AI-powered streaming pipeline specifically designed for OBS integration. It processes user inputs, generates text responses, converts text to speech, and synchronizes speech with video for creating live AI streaming content directly in OBS.

## Overview

This system integrates various AI technologies to create a complete pipeline for generating AI-based video responses specifically designed for OBS livestreaming. The pipeline includes:

1. **Text Generation**: Uses LLMs to create contextually relevant responses to user input
2. **Text-to-Speech**: Converts generated text to natural-sounding speech
3. **Lip Syncing**: Synchronizes speech with a base video to create realistic talking head videos
4. **OBS Integration**: Automatically integrates with OBS for livestreaming
5. **CLI Interface**: Provides a command-line interface for interacting with the AI

## Features

- **OBS-Focused**: Designed specifically for integration with OBS Studio for livestreaming
- **Modular Architecture**: Easily swap between different providers for each component (OpenAI/OpenRouter, ElevenLabs/Zonos TTS, etc.)
- **Vision Analysis**: Optional computer vision system that can analyze and respond to stream content
- **Configurable Prompts**: Customize AI character, behavior and responses through configuration
- **Local & API Options**: Mix and match between local services and cloud APIs based on your needs
- **CLI Control**: Full command-line interface for controlling the system during streaming

## Architecture

The system follows a modular, service-oriented architecture designed for OBS integration:

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│ User Input │ -> │ Text Gen   │ -> │ TTS        │ -> │ Video Sync │ -> │ OBS Output │
└────────────┘    └────────────┘    └────────────┘    └────────────┘    └────────────┘
```

Each component can be configured to use different implementations:

- **Text Generation**: OpenAI, OpenRouter, or custom APIs
- **TTS**: Zonos TTS (local), Zonos API, or ElevenLabs
- **Video Sync**: Local LatentSync, FAL.ai API, or Sync Labs
- **Media Streaming**: OBS integration with automatic scene management

## Requirements

- Node.js 18+ 
- Python 3.10+ (for local TTS and sync services)
- OBS Studio 28+ (with WebSocket plugin enabled)
- FFmpeg (for audio/video processing)

## Installation

### Media Requirements

Before installation, prepare the following required media files:

1. **Base Video (Required)**: 
   - A 10-20 second loopable video of the character you want to animate
   - Place in `assets/base_video.mp4`
   - Should be looking at the camera with minimal movement

2. **Base Audio (Required)**:
   - A 3-10 second audio sample of the voice you want to clone
   - Place in `assets/base_audio.wav`
   - Clear audio with minimal background noise

See [Setup Guide](docs/setup.md) for detailed media specifications.

### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/stream-service.git
   cd stream-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create required directories and add your media files:
   ```bash
   mkdir -p assets generated_videos
   # Add your base_video.mp4 and base_audio.wav to the assets directory
   ```

4. Set up environment:
   ```bash
   cp .env.example .env
   ```

5. Edit `.env` with your configuration (API keys, service selection, etc.)

6. Run the setup script:
   ```bash
   npm run setup
   ```

7. Start the service:
   ```bash
   npm run dev
   ```

### Docker Setup

Docker support coming soon!

## Configuration

The system is configured through environment variables. See `.env.example` for all available options.

Key configuration categories:

- **Server Settings**: Port, host, base URL
- **Service Selection**: Choose which implementations to use for each component
- **API Keys**: Keys for external services (OpenAI, ElevenLabs, etc.)
- **File Paths**: Locations for base videos, audio, and generated content
- **OBS Settings**: WebSocket details for OBS integration
- **Vision Settings**: Configuration for computer vision capabilities

## Usage

### CLI Mode

Run the system in CLI mode for command-line interaction:

```bash
npm run cli:dev
```

In CLI mode, you can:
- Enter text prompts that will be processed through the AI pipeline
- Watch as responses are automatically sent to OBS
- Use special commands to control the system (type 'help' for a list)

### OBS Studio Integration

The system automatically connects to OBS Studio and:
- Creates an "AI_Streamer" scene collection (or uses an existing one)
- Sets up the necessary scenes and sources
- Handles video switching between base loop and AI responses
- Enables vision-based analysis of the stream (if enabled)

Make sure OBS Studio is running with the WebSocket server enabled before starting the service.

See [OBS Setup](OBS_SETUP.md) for detailed OBS configuration instructions.

### API Endpoints

The service also exposes several REST endpoints for integration with other tools:

- `POST /input`: Submit user input to the pipeline
- `GET /health`: Check system status
- `POST /vision/start`: Start vision-based analysis
- `POST /vision/stop`: Stop vision-based analysis

See [API Documentation](docs/api.md) for details.

## Customization

### Character Customization

Edit `server/prompts/character_file.ts` to change the AI character profile. The system uses a structured format for defining personality traits, background, tone, and behavior.

### System Prompt

Modify `server/prompts/system_prompt.ts` to change the system instructions that control how the AI responds to inputs.

### Visual Identity

#### Creating a Good Base Video

The quality of your base video significantly impacts the final result. Here are tips for creating an effective base video:

1. **Recording Setup**:
   - Use good lighting (front-facing, diffused light)
   - Use a neutral background
   - Position the subject centered in the frame
   - Ensure the face is well-lit with minimal shadows

2. **Subject Guidelines**:
   - The subject should be looking directly at the camera
   - Maintain a neutral expression or slight smile
   - Minimize head movement
   - Avoid excessive blinking
   - Keep the mouth slightly open or in a natural rest position

3. **Technical Specifications**:
   - Record at 30fps (or 24fps minimum)
   - Use 1080p resolution if possible
   - Ensure the video is 10-20 seconds long
   - Create a seamless loop by matching start and end frames
   - Export as MP4 with H.264 encoding

4. **Placement**:
   - Save your video as `assets/base_video.mp4`

You can edit your video with software like Adobe Premiere, DaVinci Resolve, or even free tools like Shotcut to ensure it loops smoothly.

#### Base Audio Guidelines

For the base audio sample:

1. Record 5-10 seconds of clear speech in the target voice
2. Use a good microphone in a quiet environment
3. Process the audio to remove background noise
4. Save as a 44.1kHz, 16-bit WAV file
5. Place in `assets/base_audio.wav`

## Local Services

The system can use local services for TTS and video synchronization:

### Zonos TTS

A local TTS service that converts text to natural-sounding speech.

Setup:
```bash
./scripts/setup_zonos.sh
```

### LatentSync

A local service for lip-syncing audio to video.

Setup:
```bash
./scripts/setup_latentsync.sh
```

## OBS Integration

The system can integrate with OBS for livestreaming. See [OBS Setup](OBS_SETUP.md) for details.

## Development

### Building the Project

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Adding New Services

The modular architecture makes it easy to add new service implementations:

1. Create a new class that implements the appropriate interface in `server/services/interfaces.ts`
2. Add the service type to the appropriate enum in `server/types/index.ts`
3. Update the configuration handler in `server/config.ts`
4. Add the service to the factory in `server/services/PipelineInitializer.ts`

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

This project utilizes several amazing technologies:
- OpenAI's GPT models for text generation
- Zonos TTS for speech synthesis
- LatentSync for video synchronization
- OBS Studio for streaming integration

## Security

See [SECURITY.md](SECURITY.md) for security considerations and reporting vulnerabilities.