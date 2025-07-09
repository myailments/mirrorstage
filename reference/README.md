# Reference Implementations

This directory contains reference implementations for various services used by the AI Stream Service. These are provided for educational and development purposes, and are not required for the main application to function if you're using cloud-based alternatives.

## Directories

### deepseek

Reference implementation for a text generation service using the DeepSeek language model. This can be used as an alternative to OpenAI or OpenRouter APIs.

### latentsync

Reference implementation for a video synchronization service that can lip-sync audio to video. This is provided as a local alternative to cloud-based services like FAL.ai or Sync Labs.

### zonos-tts

Reference implementation for a text-to-speech service using the Zonos model. This provides a local alternative to cloud TTS services like ElevenLabs.

## Using Reference Implementations

These reference implementations can be run as local services, typically on specific ports that the main application will connect to. The setup scripts (`scripts/setup_zonos.sh` and `scripts/setup_latentsync.sh`) will install the necessary dependencies for these services.

For example, to use the local LatentSync implementation instead of a cloud service, you would:

1. Run the setup script: `./scripts/setup_latentsync.sh`
2. Configure your `.env` file to use the local service:
   ```
   USE_LOCAL_LATENT_SYNC=true
   USE_FAL_LATENT_SYNC=false
   USE_SYNC_LABS=false
   ```
3. Start the service with the main application

## Developing Custom Implementations

You can use these reference implementations as starting points for developing your own custom implementations. Each directory includes a basic server implementation that follows the API expected by the main application.

To create a custom implementation:

1. Study the existing reference implementation
2. Understand the expected API endpoints and behavior
3. Create your own implementation following the same pattern
4. Update the configuration to use your custom implementation

## Notes

- These reference implementations may require significant computational resources, especially for the video synchronization and text generation services
- They are provided for educational purposes and may not be optimized for production use
- When using local implementations, performance will depend on your hardware capabilities