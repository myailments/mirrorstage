// Configuration handler
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Config } from './types/index.js';
import { LLMService, TTSService, VideoSyncService } from './types/index.js';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Service selection logic
const getLLMService = (): LLMService => {
  if (process.env.USE_OPENROUTER === 'true') return LLMService.OPENROUTER;
  if (process.env.USE_DEEPSEEK_LOCAL === 'true') return LLMService.DEEPSEEK;
  if (process.env.USE_CLOUDY_API === 'true') return LLMService.CLOUDY;
  return LLMService.OPENAI; // default
};

const getTTSService = (): TTSService => {
  if (process.env.USE_ZONOS_TTS_LOCAL === 'true') return TTSService.ZONOS_LOCAL;
  if (process.env.USE_ZONOS_TTS_API === 'true') return TTSService.ZONOS_API;
  if (process.env.USE_ELEVENLABS === 'true') return TTSService.ELEVENLABS;
  return TTSService.ZONOS_LOCAL; // default
};

const getVideoSyncService = (): VideoSyncService => {
  if (process.env.USE_FAL_LATENT_SYNC === 'true') return VideoSyncService.FAL;
  if (process.env.USE_SYNC_LABS === 'true') return VideoSyncService.SYNC_LABS;
  return VideoSyncService.LOCAL; // default
};

const selectedServices = {
  llm: getLLMService(),
  tts: getTTSService(),
  videoSync: getVideoSyncService()
};

const config: Config = {
  // Server configuration
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.BASE_URL || 'http://localhost',

  // File paths
  baseVideoPath: process.env.BASE_VIDEO_PATH || './assets/base_video.mp4',
  outputDir: process.env.OUTPUT_DIR || './generated_videos',
  baseAudioPath: process.env.BASE_AUDIO_PATH || './assets/base_audio.wav',

  // Queue configuration
  minQueueSize: parseInt(process.env.MIN_QUEUE_SIZE || '3', 10),
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '10', 10),

  // Text Generation (LLM) Configuration
  // OpenRouter
  useOpenRouter: selectedServices.llm === LLMService.OPENROUTER,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3-0324:free',
  openRouterSiteUrl: process.env.OPENROUTER_SITE_URL,
  openRouterSiteName: process.env.OPENROUTER_SITE_NAME,

  // Deepseek Local
  useDeepseekLocal: selectedServices.llm === LLMService.DEEPSEEK,
  deepseekEndpoint: process.env.DEEPSEEK_ENDPOINT || '/v1',
  deepseekPort: Number(process.env.DEEPSEEK_PORT) || 8000,

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY,

  // CloudyAPI
  useCloudyAPI: selectedServices.llm === LLMService.CLOUDY,

  // Text-to-Speech (TTS) Configuration
  // Zonos Local
  useZonosTTSLocal: selectedServices.tts === TTSService.ZONOS_LOCAL,
  zonosTtsEndpoint: process.env.ZONOS_TTS_ENDPOINT || '/tts',
  zonosTtsPort: Number(process.env.ZONOS_TTS_PORT) || 8001,

  // Zonos API
  useZonosTTSAPI: selectedServices.tts === TTSService.ZONOS_API,
  zonosApiKey: process.env.ZONOS_API_KEY,

  // ElevenLabs
  useElevenLabs: selectedServices.tts === TTSService.ELEVENLABS,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,

  // Video Sync Configuration
  // Local LatentSync
  latentsyncEndpoint: process.env.LATENTSYNC_ENDPOINT || '/sync',
  latentSyncPort: Number(process.env.LATENTSYNC_PORT) || 8002,

  // FAL API LatentSync
  useFalLatentSync: selectedServices.videoSync === VideoSyncService.FAL,
  falApiKey: process.env.FAL_KEY,

  // Sync Labs
  useSyncLabs: selectedServices.videoSync === VideoSyncService.SYNC_LABS,
  syncLabsKey: process.env.SYNC_LABS_KEY,

  // Add selected services for reference
  selectedServices,
};

// Validate configuration
const validateConfig = (config: Config) => {
  // Ensure LLM service has required credentials
  if (config.selectedServices.llm === LLMService.OPENROUTER && !config.openRouterApiKey) {
    throw new Error('OpenRouter API key is required when using OpenRouter');
  }
  if (config.selectedServices.llm === LLMService.OPENAI && !config.openaiApiKey) {
    throw new Error('OpenAI API key is required when using OpenAI');
  }

  // Ensure TTS service has required credentials
  if (config.selectedServices.tts === TTSService.ZONOS_API && !config.zonosApiKey) {
    throw new Error('Zonos API key is required when using Zonos API');
  }
  if (config.selectedServices.tts === TTSService.ELEVENLABS && !config.elevenLabsApiKey) {
    throw new Error('ElevenLabs API key is required when using ElevenLabs');
  }

  // Ensure Video Sync service has required credentials
  if (config.selectedServices.videoSync === VideoSyncService.FAL && !config.falApiKey) {
    throw new Error('FAL API key is required when using FAL LatentSync');
  }
};

validateConfig(config);

export default config;