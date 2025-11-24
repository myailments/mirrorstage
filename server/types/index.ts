// Core types for the application

// Message ingestion service types
export const MessageIngestionServiceType = {
  PUMP_FUN: 'pump-fun',
} as const;

export type MessageIngestionServiceType =
  (typeof MessageIngestionServiceType)[keyof typeof MessageIngestionServiceType];

// Configuration type
export interface Config {
  // Server configuration
  port: number;
  host: string;
  baseUrl: string;

  // File paths
  baseVideoPath: string;
  outputDir: string;

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

  // Inworld AI Configuration
  inworldApiKey?: string;
  inworldVoiceId?: string;

  // FAL API Configuration (Video Sync)
  falApiKey?: string;

  // Message Ingestion Configuration
  // Pump.fun
  usePumpFun?: boolean;
  pumpFunUrl?: string;
  pumpFunHeadless?: boolean;

  // OBS WebSocket Configuration
  obsWebSocketHost: string;
  obsWebSocketPort: number;
  obsWebSocketPassword?: string;
  obsWebSocketTimeout?: number;
  obsWebSocketMaxRetries?: number;
  obsWebSocketRetryDelay?: number;
  obsBaseSceneName: string;
  obsGeneratedSceneName: string;
  obsGeneratedSourceName: string;

  // Test mode
  testMode?: boolean;
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
