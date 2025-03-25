// Core types for the application

// Configuration type
export interface Config {
  // Server configuration
  port: number;
  host: string;
  baseUrl: string;

  // LLM configuration
  openaiApiKey?: string;
  useDeepseekLocal?: boolean;
  deepseekEndpoint?: string;
  deepseekPort?: number;
  
  // File paths
  baseVideoPath: string;
  baseAudio?: string;
  baseAudioPath?: string;
  outputDir: string;
  
  // Service flags and configurations
  useZonosTTSAPI: boolean;
  zonosApiKey?: string;

  useZonosTTSLocal: boolean;
  zonosTtsEndpoint: string;
  latentsyncEndpoint: string;

  zonosTtsPort: number;
  latentSyncPort: number;

  useElevenLabs: boolean;
  elevenLabsVoiceId: string;
  elevenLabsApiKey?: string;

  useCloudyAPI: boolean;
    
  useFalLatentSync: boolean;
  falApiKey?: string;

  // Queue configuration
  minQueueSize: number;
  maxQueueSize: number;
  maxConcurrent?: number;
  minPriority?: number;
  checkInterval?: number;

  // Test mode
  testMode?: boolean;
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