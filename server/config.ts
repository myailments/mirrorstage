// Configuration handler

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { Config } from './types/index.js';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config: Config = {
  // Server configuration
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.BASE_URL || 'http://localhost',

  // File paths
  baseVideoPath: process.env.BASE_VIDEO_PATH || './assets/base_video.mp4',
  outputDir: process.env.OUTPUT_DIR || './generated_videos',

  // Queue configuration
  minQueueSize: Number.parseInt(process.env.MIN_QUEUE_SIZE || '3', 10),
  maxQueueSize: Number.parseInt(process.env.MAX_QUEUE_SIZE || '10', 10),
  maxConcurrent: Number.parseInt(process.env.MAX_CONCURRENT || '10', 10),
  minPriority: Number.parseInt(process.env.MIN_PRIORITY || '3', 10),

  // Inworld AI Configuration
  inworldApiKey: process.env.INWORLD_API_KEY,
  inworldVoiceId: process.env.INWORLD_VOICE_ID,

  // FAL API Configuration (Video Sync)
  falApiKey: process.env.FAL_KEY,

  // OBS WebSocket configuration
  obsWebSocketHost: process.env.OBS_WEBSOCKET_HOST || 'localhost',
  obsWebSocketPort: Number(process.env.OBS_WEBSOCKET_PORT) || 4455,
  obsWebSocketPassword: process.env.OBS_WEBSOCKET_PASSWORD,
  obsBaseSceneName: process.env.OBS_BASE_SCENE || 'Base Scene',
  obsGeneratedSceneName: process.env.OBS_GENERATED_SCENE || 'Generated Scene',
  obsGeneratedSourceName: process.env.OBS_GENERATED_SOURCE || 'Generated Video',

  // Vision configuration
  useVision: process.env.USE_VISION === 'true',
  visionSourceName: process.env.VISION_SOURCE_NAME || 'Display Capture',
  visionIntervalSeconds: Number.parseInt(
    process.env.VISION_INTERVAL_SECONDS || '30',
    10
  ),
  visionPrompt:
    process.env.VISION_PROMPT ||
    'You are analyzing a livestream. What is happening in this image?',

  // Message Ingestion Configuration
  usePumpFun: process.env.USE_PUMP_FUN === 'true',
  pumpFunUrl: process.env.PUMP_FUN_URL,
  pumpFunHeadless: process.env.PUMP_FUN_HEADLESS === 'true',
};

// Validate configuration
const validateConfig = (cfg: Config) => {
  // Ensure Inworld API key is present
  if (!cfg.inworldApiKey) {
    throw new Error('INWORLD_API_KEY is required');
  }

  // Ensure FAL API key is present for video sync
  if (!cfg.falApiKey) {
    throw new Error('FAL_KEY is required for video sync');
  }
};

validateConfig(config);

export default config;
