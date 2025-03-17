// Configuration handler
require('dotenv').config();

const config = {
  // Server configuration
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  
  // OpenAI configuration
  openaiApiKey: process.env.OPENAI_API_KEY,
  
  // File paths
  baseVideoPath: process.env.BASE_VIDEO_PATH || './assets/base_video.mp4',
  outputDir: process.env.OUTPUT_DIR || './generated_videos',
  
  // Model endpoints
  zonosTtsEndpoint: process.env.ZONOS_TTS_ENDPOINT || 'http://localhost:8001/tts',
  latentsyncEndpoint: process.env.LATENTSYNC_ENDPOINT || 'http://localhost:8002/sync',
  
  // Queue configuration
  minQueueSize: parseInt(process.env.MIN_QUEUE_SIZE || '3', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '10', 10),
};

module.exports = config;
