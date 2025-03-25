// Configuration handler
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Config } from './types/index.js';

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

  // LLM configuration
  openaiApiKey: process.env.OPENAI_API_KEY,
  useDeepseekLocal: process.env.USE_DEEPSEEK_LOCAL === 'true',
  deepseekEndpoint: process.env.DEEPSEEK_ENDPOINT || '/v1',
  deepseekPort: Number(process.env.DEEPSEEK_PORT) || 8000,
  
  // OpenRouter configuration
  useOpenRouter: process.env.USE_OPENROUTER === 'true',
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3-0324:free',
  openRouterSiteUrl: process.env.OPENROUTER_SITE_URL,
  openRouterSiteName: process.env.OPENROUTER_SITE_NAME,
  
  // File paths
  baseVideoPath: process.env.BASE_VIDEO_PATH || './assets/base_video.mp4',
  outputDir: process.env.OUTPUT_DIR || './generated_videos',
  baseAudioPath: process.env.BASE_AUDIO_PATH || './assets/base_audio.wav',
  
  // Models
  useZonosTTSAPI: process.env.USE_ZONOS_TTS_API === 'true',
  zonosApiKey: process.env.ZONOS_API_KEY,

  useZonosTTSLocal: process.env.USE_ZONOS_TTS_LOCAL === 'true',
  zonosTtsEndpoint: process.env.ZONOS_TTS_ENDPOINT || '/tts',
  latentsyncEndpoint: process.env.LATENTSYNC_ENDPOINT || '/sync',

  // MuseTalk configuration
  // useMuseTalk: process.env.USE_MUSE_TALK === 'true',
  useMuseTalk: true,
  museTalkEndpoint: process.env.MUSE_TALK_ENDPOINT || '/sync',
  museTalkPort: Number(process.env.MUSE_TALK_PORT) || 8080,

  zonosTtsPort: Number(process.env.ZONOS_TTS_PORT) || 8001,
  latentSyncPort: Number(process.env.LATENTSYNC_PORT) || 8002,

  useElevenLabs: false,
  elevenLabsVoiceId: '4ktOZjIcYueSlqN5UZjv',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,

  useCloudyAPI: false,
    
  useFalLatentSync: false,
  falApiKey: process.env.FAL_KEY,

  // Queue configuration
  minQueueSize: parseInt(process.env.MIN_QUEUE_SIZE || '3', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '10', 10),
};


export default config;