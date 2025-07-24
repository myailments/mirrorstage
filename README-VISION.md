# Vision System Documentation

The Stream Service includes an intelligent vision processing system that analyzes your stream in real-time and generates contextual responses when significant changes are detected.

## How It Works

### Overview
The vision system captures screenshots from your OBS stream every 30 seconds, analyzes them using AI, and only generates responses when something meaningful has changed. This prevents endless loops and ensures responses are relevant to what's actually happening on stream.

### Architecture

```
OBS Stream → Screenshot Capture → AI Analysis → Change Detection → Response Generation
     ↓              ↓                   ↓             ↓                ↓
   Every 30s    GPT-4o-mini        Context-aware   Only if changed   Video Pipeline
```

### Key Components

1. **VisionProcessor** (`server/services/VisionProcessor.ts`)
   - Main service that orchestrates the vision workflow
   - Manages screenshot capture intervals
   - Handles AI analysis and change detection
   - Emits events when changes are detected

2. **OBS Integration** (`server/services/OBSStream.ts`)
   - Captures screenshots from specified OBS sources
   - Supports custom output paths for temporary files
   - Handles OBS connection and source validation

3. **Pipeline Integration** (`server/app.ts`)
   - Integrates vision analysis with the main processing pipeline
   - Creates pipeline items from vision events
   - Manages the overall vision system lifecycle

## Configuration

### Config Options

Add these to your `config.ts`:

```typescript
{
  useVision: true,                    // Enable/disable vision processing
  visionSourceName: "Display Capture", // OBS source to capture from
  visionIntervalSeconds: 30,          // How often to capture (seconds)
  visionPrompt: "Custom prompt..."    // Optional custom analysis prompt
}
```

### Environment Setup

1. **OBS Connection**: Ensure OBS WebSocket is enabled and connected
2. **OpenAI API Key**: Required for GPT-4o-mini vision analysis
3. **Screenshots Directory**: Created automatically at `./screenshots/`

## Features

### Intelligent Change Detection

The system uses contextual analysis to determine if something has changed:

- **Context Window**: Maintains last 5 screenshot descriptions
- **Change Indicators**: Looks for phrases like "no significant changes" or "remains the same"
- **Threshold-based**: Only processes when confidence > 80%

### Memory Management

- **Immediate Cleanup**: Screenshots deleted right after analysis
- **Batch Cleanup**: Removes any leftover screenshots on shutdown
- **No Accumulation**: Prevents disk space issues from screenshot buildup

### Loop Prevention

- **Change-based Triggering**: Only generates responses when scene changes
- **Context Awareness**: AI knows what happened in previous screenshots
- **Smart Filtering**: Ignores minor/irrelevant changes

## Usage

### Automatic Startup

If `useVision: true` in config, the system starts automatically when:
1. The application initializes
2. OBS is connected
3. The specified source exists

### Manual Control

```typescript
// Start vision processing
const success = await visionProcessor.start();

// Stop vision processing  
visionProcessor.stop();

// Handle vision events
visionProcessor.on('visionAnalysis', (analysis) => {
  console.log('Scene changed:', analysis.description);
});
```

### Integration with Pipeline

When a change is detected, the system:

1. Creates a pipeline item with `userId: 'vision-system'`
2. Sets message context: `"You are a livestreamer. This is what you see on stream: {description}"`
3. Processes through normal TTS → Video → OBS pipeline
4. Tracks progress like any other pipeline item

## Troubleshooting

### Common Issues

**Vision not starting:**
- Check `useVision: true` in config
- Verify OBS is connected
- Ensure source name exists in current scene

**No responses generated:**
- Check if AI detects changes (look for "No significant changes" in logs)
- Verify OpenAI API key is valid
- Check pipeline capacity (`maxConcurrent` setting)

**Screenshots accumulating:**
- System should auto-cleanup - check for errors in logs
- Manually clean `./screenshots/` directory if needed
- Restart service to reset cleanup timers

### Debug Logging

Enable detailed logging to troubleshoot:

```typescript
// Look for these log messages:
"Vision processing started with X second interval"
"Capturing screenshot"
"Scene has changed, emitting analysis"
"Vision analysis received: ..."
```

### Performance Considerations

- **GPU Usage**: Vision analysis uses OpenAI API, not local GPU
- **Network**: Requires stable internet for AI analysis
- **Disk I/O**: Minimal due to immediate screenshot cleanup
- **Memory**: Low impact, maintains only 5 recent descriptions

## Advanced Configuration

### Custom Analysis Prompts

Customize how the AI analyzes your stream:

```typescript
visionPrompt: `
  You are analyzing a coding livestream. Focus on:
  - What code is being written
  - Any errors or successes
  - Changes in the development environment
  - Viewer interactions or questions
`
```

### Interval Tuning

Adjust capture frequency based on your stream type:

```typescript
visionIntervalSeconds: 15  // Fast-paced gaming stream
visionIntervalSeconds: 60  // Slow-paced tutorial stream
```

### Source Selection

Choose the right OBS source:

```typescript
visionSourceName: "Game Capture"     // For gaming streams
visionSourceName: "Display Capture" // For desktop/coding
visionSourceName: "Camera"          // For talking head streams
```

## Architecture Decisions

### Why GPT-4o-mini?
- Optimized for vision tasks
- Cost-effective for frequent analysis
- Good balance of speed and accuracy

### Why Change Detection?
- Prevents infinite response loops
- Reduces unnecessary processing
- Ensures responses are contextually relevant

### Why Immediate Cleanup?
- Prevents disk space issues
- Maintains system performance
- Simplifies debugging (no old files)

## Future Enhancements

Potential improvements for the vision system:

1. **Multi-source Analysis**: Capture from multiple OBS sources
2. **Scene Transition Detection**: React to OBS scene changes
3. **Object Detection**: Identify specific items/people in frame
4. **Sentiment Analysis**: Detect mood/emotion from visual cues
5. **Integration with Chat**: Combine vision with chat context