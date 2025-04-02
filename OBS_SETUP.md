# OBS Setup for AI Live-Streamer

This guide will help you set up OBS Studio to work with the AI Live-Streamer for seamless video transitions between AI-generated content and base video.

## Requirements

1. OBS Studio (version 28.0.0 or higher) - [Download here](https://obsproject.com/)
2. OBS WebSocket Plugin (included in OBS Studio 28.0.0+)

## OBS WebSocket Setup

1. Open OBS Studio
2. Go to `Tools > WebSocket Server Settings`
3. Enable the WebSocket server
4. Set the port to `4455` (or your preferred port, make sure to update in .env)
5. If you want to secure your connection, enable authentication and set a password (make sure to update in .env)
6. Click "OK" to save the settings

## No Manual Setup Required!

The application will automatically:

1. Create a new dedicated scene collection named "AI_Streamer" (or switch to it if it already exists)
2. Create a "Base Scene" with your base looping video
3. Create a "Generated Scene" for AI-generated videos
4. Create appropriate sources and set up transitions
5. Handle video switching and cleanup automatically

This completely automatic setup means you don't need to manually configure anything in OBS! Your existing OBS scene collections will remain untouched, as the system creates a dedicated collection for the AI streamer.

## Testing Your Setup

1. Launch OBS and ensure the WebSocket server is running
2. Update your `.env` file with the correct OBS configuration:
   ```
   USE_OBS=true
   OBS_WEBSOCKET_HOST=localhost
   OBS_WEBSOCKET_PORT=4455
   OBS_WEBSOCKET_PASSWORD=your_password  # Leave blank if not using authentication
   OBS_BASE_SCENE=Base Scene
   OBS_GENERATED_SCENE=Generated Scene
   ```
3. Start your AI Live-Streamer application
4. The application will automatically create and configure the necessary scenes
5. Submit a message to generate an AI response
6. OBS should automatically switch between the Base Scene and Generated Scene

## Streaming Setup

1. Set up your streaming platform (Twitch, YouTube, etc.) in OBS:
   - Go to `Settings > Stream`
   - Select your streaming service and enter your stream key
   - Configure your output settings in the `Output` tab
   
2. Start streaming by clicking the "Start Streaming" button in OBS

## Troubleshooting

- **Connection Failed**: Ensure the WebSocket server is enabled in OBS and the port matches your .env settings
- **Scene Not Switching**: Check that the scene names in OBS exactly match the names in your .env file
- **Video Not Playing**: Ensure the media source name in OBS matches the name in your .env file
- **Path Issues**: Ensure your application has full path access to the video files

## OBS Advanced Settings (Optional)

For smoother transitions, you can configure scene transitions:
1. Go to `Scene Transitions` panel
2. Select a transition type (Fade, Stinger, etc.)
3. Set the duration to a short time (300ms recommended)