// Core types for the application

// Service type enums
export const LLMService = {
  OPENROUTER: 'openrouter',
  CLOUDY: 'cloudy',
  OPENAI: 'openai',
} as const;

export type LLMService = (typeof LLMService)[keyof typeof LLMService];

export const TTSService = {
  ZONOS_LOCAL: 'zonos-local',
  ZONOS_API: 'zonos-api',
  ELEVENLABS: 'elevenlabs',
} as const;

export type TTSService = (typeof TTSService)[keyof typeof TTSService];

export const VideoSyncService = {
  LOCAL: 'local',
  FAL_LATENT_SYNC: 'fal-latent-sync',
  SYNC_LABS: 'sync-labs',
  FAL_PIXVERSE: 'fal-pixverse',
} as const;

export type VideoSyncService =
  (typeof VideoSyncService)[keyof typeof VideoSyncService];

export const MessageIngestionServiceType = {
  PUMP_FUN: 'pump-fun',
} as const;

export type MessageIngestionServiceType =
  (typeof MessageIngestionServiceType)[keyof typeof MessageIngestionServiceType];

// Selected services configuration
export interface SelectedServices {
  llm: LLMService;
  tts: TTSService;
  videoSync: VideoSyncService;
  messageIngestion?: MessageIngestionServiceType;
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
  maxConcurrent: number;
  minPriority: number;
  checkInterval?: number;

  // Vision configuration
  useVision?: boolean;
  visionSourceName?: string;
  visionIntervalSeconds?: number;
  visionPrompt?: string;

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

  // FAL API
  falApiKey?: string;

  // FAL API LatentSync
  useFalLatentSync: boolean;

  // FAL API Pixverse
  useFalPixverse: boolean;
  // Sync Labs

  useSyncLabs: boolean;
  syncLabsKey?: string;

  // Message Ingestion Configuration
  // Pump.fun
  usePumpFun?: boolean;
  pumpFunUrl?: string;
  pumpFunHeadless?: boolean;

  // Media Stream Configuration
  // OBS WebSocket
  obsWebSocketHost: string;
  obsWebSocketPort: number;
  obsWebSocketPassword?: string;
  obsWebSocketTimeout?: number; // Connection timeout in milliseconds (default: 10000)
  obsWebSocketMaxRetries?: number; // Maximum connection retries (default: 3)
  obsWebSocketRetryDelay?: number; // Delay between retries in milliseconds (default: 5000)
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
export const PipelineStatus = {
  RECEIVED: 'received',
  EVALUATING: 'evaluating',
  REJECTED: 'rejected',
  GENERATING_RESPONSE: 'generating_response',
  GENERATING_SPEECH: 'generating_speech',
  GENERATING_VIDEO: 'generating_video',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type PipelineStatus =
  (typeof PipelineStatus)[keyof typeof PipelineStatus];

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

// Stream analysis types

export const StreamAnalysisService = {
  GPT_VISION: 'gpt-vision',
  CLAUDE: 'claude',
  GOOGLE_VISION: 'google-vision',
} as const;

export type StreamAnalysisService =
  (typeof StreamAnalysisService)[keyof typeof StreamAnalysisService];

export interface StreamAnalysisResult {
  timestamp: string;
  imagePath: string;
  analysis: {
    description: string;
    confidence?: number;
    detectedObjects?: DetectedObject[];
    detectedText?: string;
    model: string;
    tokensUsed?: number;
  };
}

export interface DetectedObject {
  name: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface StreamAnalysisConfig {
  enabled: boolean;
  service: StreamAnalysisService;
  captureSource: string;
  captureFrequencyMs: number;
  analysisPrompt: string;
  saveScreenshots: boolean;
  maxStoredScreenshots: number;
}

// OBS-related types for better type safety
export interface OBSScene {
  sceneName: string;
  sceneUuid: string;
  sceneIndex: number;
}

export interface OBSSceneItem {
  sceneItemId: number;
  sourceName: string;
  sceneItemIndex: number;
  sceneItemEnabled: boolean;
}

export interface OBSMediaEvent {
  inputName: string;
  inputUuid: string;
}
