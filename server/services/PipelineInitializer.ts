import { logger } from '../utils/logger.js';
import { FileManager } from './FileManager.js';
import { MessageEvaluator, TestMessageEvaluator } from './Evaluator.js';
import { ZonosTTS, ElevenLabsTTS, ZonosTTSAPI, TestTTS } from './TTS.js';
import { LocalLatentSync, FalLatentSync, TestVideoSync, SyncLabsSync } from './VideoSync.js';
import { TestTextGenerator, TextGenerator } from './TextGenerator.js';
import type { Config } from '../types/index.js';
import { TTSService, VideoSyncService } from './interfaces.js';

export interface PipelineServices {
  fileManager: FileManager;
  evaluator: MessageEvaluator;
  textGenerator: TextGenerator;
  tts: TTSService;
  sync: VideoSyncService;
}

export class PipelineInitializer {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Initialize all pipeline components
   */
  async initialize(): Promise<PipelineServices> {
    try {
      // Initialize file manager
      const fileManager = new FileManager(this.config);
      await fileManager.initializeDirectories();
      fileManager.verifyBaseVideo();
      fileManager.verifyBaseAudio();

      // Initialize services
      const services: PipelineServices = {
        fileManager,
        evaluator: this.config.testMode ? 
          new TestMessageEvaluator(this.config) :
          new MessageEvaluator(this.config),
        textGenerator: this.config.testMode ? 
          new TestTextGenerator(this.config) :
          new TextGenerator(this.config),
        tts: this.config.testMode ? 
          new TestTTS(this.config) :
          this.config.useElevenLabs ? 
          new ElevenLabsTTS(this.config) : 
          this.config.useZonosTTSLocal ?
          new ZonosTTS(this.config) : 
          this.config.useZonosTTSAPI ?
          new ZonosTTSAPI(this.config) : 
          // Default to ZonosTTS if no service specified
          new ZonosTTS(this.config),
        sync: this.config.testMode ? 
          new TestVideoSync(this.config) :
          this.config.useFalLatentSync ? 
          new FalLatentSync(this.config) : 
          this.config.useSyncLabs ?
          new SyncLabsSync(this.config) :
          new LocalLatentSync(this.config)
      };``


      // Test service connections
      await this.testServices(services);

      logger.info('Pipeline initialization complete');
      return services;

    } catch (error) {
      logger.error(`Pipeline initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Test service connections
   */
  async testServices(services: PipelineServices): Promise<void> {
    // Test text generation service
    try {
      await services.textGenerator.testConnection();
      logger.info('Text generation service connection verified');
    } catch (error) {
      logger.warn(`Text generation service warning: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Test TTS service
    try {
      await services.tts.testConnection();
      logger.info('TTS service connection verified');
    } catch (error) {
      logger.warn(`TTS service connection warning: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Test Sync service
    try {
      await services.sync.testConnection();
      logger.info('Video sync service connection verified');
    } catch (error) {
      logger.warn(`Video sync service connection warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}