// Core types for the application

// Service type enums
export enum LLMService {
  OPENROUTER = 'openrouter',
  CLOUDY = 'cloudy',
  OPENAI = 'openai'
}

export enum TTSService {
  ZONOS_LOCAL = 'zonos-local',
  ZONOS_API = 'zonos-api',
  ELEVENLABS = 'elevenlabs'
}

export enum VideoSyncService {
  LOCAL = 'local',
  FAL = 'fal',
  SYNC_LABS = 'sync-labs'
}

export enum MediaStreamService {
  CLIENT = 'client',
  OBS = 'obs'
}

// Selected services configuration
export interface SelectedServices {
  llm: LLMService;
  tts: TTSService;
  videoSync: VideoSyncService;
  mediaStream: MediaStreamService;
}

// Configuration type
export interface Config {
  // Server configuration
  port: number;
  host: string;
  baseUrl: string;

  // File paths
  baseVideoPath: string;
  outputDir: string;
  baseAudioPath: string;

  // Queue configuration
  minQueueSize: number;
  maxQueueSize: number;
  maxConcurrent?: number;
  minPriority?: number;
  checkInterval?: number;

  // Service Selection
  selectedServices: SelectedServices;

  // LLM Configuration
  // OpenRouter
  useOpenRouter: boolean;
  openRouterApiKey?: string;
  openRouterGenerationModel?: string;
  openRouterEvaluationModel?: string;
  openRouterSiteUrl?: string;
  openRouterSiteName?: string;


  // OpenAI
  openaiApiKey?: string;

  // CloudyAPI
  useCloudyAPI: boolean;

  // TTS Configuration
  // Zonos Local
  useZonosTTSLocal: boolean;
  zonosTtsEndpoint: string;
  zonosTtsPort: number;

  // Zonos API
  useZonosTTSAPI: boolean;
  zonosApiKey?: string;

  // ElevenLabs
  useElevenLabs: boolean;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;

  // Video Sync Configuration
  // Local LatentSync
  latentsyncEndpoint: string;
  latentSyncPort: number;

  // FAL API LatentSync
  useFalLatentSync: boolean;
  falApiKey?: string;

  // Sync Labs
  useSyncLabs: boolean;
  syncLabsKey?: string;

  // Media Stream Configuration
  // OBS WebSocket
  useOBS: boolean;
  obsWebSocketHost: string;
  obsWebSocketPort: number;
  obsWebSocketPassword?: string;
  obsBaseSceneName: string;
  obsGeneratedSceneName: string;
  obsGeneratedSourceName: string;

  // Test mode
  testMode?: boolean;

  supabaseUrl?: string;
  supabaseKey?: string;

  // AWS Configuration
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsBucketName?: string;
}

// Pipeline Item Status
export enum PipelineStatus {
  RECEIVED = 'received',
  EVALUATING = 'evaluating',
  REJECTED = 'rejected',
  GENERATING_RESPONSE = 'generating_response',
  GENERATING_SPEECH = 'generating_speech',
  GENERATING_VIDEO = 'generating_video',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

// Status update
export interface StatusUpdate {
  status: PipelineStatus;
  timestamp: number;
}

// Pipeline item
export interface PipelineItem {
  messageId: string;
  userId: string;
  message: string;
  response?: string;
  audioPath?: string;
  videoPath?: string;
  error?: string;
  status: PipelineStatus;
  timestamp: number;
  updates: StatusUpdate[];
  priority?: number;
}

// Completed video info
export interface CompletedVideo {
  messageId: string;
  userId: string;
  message: string;
  response: string;
  videoPath: string;
  timestamp: number;
}

// Pipeline status summary
export interface PipelineStatusSummary {
  activeProcessing: number;
  maxConcurrent: number;
  totalItems: number;
  statusCounts: Record<PipelineStatus, number>;
  recentUpdates: {
    messageId: string;
    status: PipelineStatus;
    lastUpdate: number;
  }[];
}

// API response for input
export interface InputResponse {
  messageId: string;
  status: PipelineStatus;
}