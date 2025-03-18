// Configuration handler
import 'dotenv/config';

const config = {
  // Server configuration
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.BASE_URL || 'http://localhost',


  // OpenAI configuration
  openaiApiKey: process.env.OPENAI_API_KEY,
  
  // File paths
  baseVideoPath: process.env.BASE_VIDEO_PATH || './assets/base_video.mp4',
  outputDir: process.env.OUTPUT_DIR || './generated_videos',
  baseAudioPath: process.env.BASE_AUDIO_PATH || './assets/base_audio.wav',
  // Models
  useZonosTTSAPI: process.env.USE_ZONOS_TTS_API || false,
  zonosApiKey: process.env.ZONOS_API_KEY,

  useZonosTTSLocal: process.env.USE_ZONOS_TTS_LOCAL || false,
  zonosTtsEndpoint: process.env.ZONOS_TTS_ENDPOINT || '/tts',
  latentsyncEndpoint: process.env.LATENTSYNC_ENDPOINT || '/sync',

  zonosTtsPort: process.env.ZONOS_TTS_PORT || 8001,
  latentSyncPort: process.env.LATENTSYNC_PORT || 8002,

  useElevenLabs: false,
  elevenLabsVoiceId: '4ktOZjIcYueSlqN5UZjv',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    
  useFalLatentSync: true,
  falApiKey: process.env.FAL_KEY,

  // Queue configuration
  minQueueSize: parseInt(process.env.MIN_QUEUE_SIZE || '3', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '10', 10),

};

export default config;
