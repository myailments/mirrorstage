import type { Config } from '../types/index.js';

// TTS Service interface
export interface TTSService {
  convert(text: string): Promise<string>;
  testConnection(): Promise<boolean>;
}

// Video Sync Service interface
export interface VideoSyncService {
  process(audioPath: string): Promise<string>;
  testConnection(): Promise<boolean>;
}

// Service factory interface
export interface ServiceFactory {
  createTTSService(config: Config): TTSService;
  createVideoSyncService(config: Config): VideoSyncService;
}
