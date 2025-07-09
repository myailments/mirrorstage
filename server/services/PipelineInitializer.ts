import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { MessageEvaluator, TestMessageEvaluator } from './Evaluator.js';
import { FileManager } from './FileManager.js';
import type { TTSService, VideoSyncService } from './interfaces.js';
import { OBSStream } from './OBSStream.js';
import { TestTextGenerator, TextGenerator } from './TextGenerator.js';
import { ElevenLabsTTS, TestTTS, ZonosTTS, ZonosTTSAPI } from './TTS.js';
import {
  FalLatentSync,
  LocalLatentSync,
  SyncLabsSync,
  TestVideoSync,
} from './VideoSync.js';

export interface PipelineServices {
  fileManager: FileManager;
  evaluator: MessageEvaluator;
  textGenerator: TextGenerator;
  tts: TTSService;
  sync: VideoSyncService;
  obsStream: OBSStream;
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
      fileManager.initializeDirectories();
      fileManager.verifyBaseVideo();
      fileManager.verifyBaseAudio();

      // Initialize services
      const services: PipelineServices = {
        fileManager,
        evaluator: this.createEvaluatorService(),
        textGenerator: this.createTextGeneratorService(),
        tts: this.createTTSService(),
        sync: this.createSyncService(),
        obsStream: this.createOBSService(),
      };

      // Connect to OBS WebSocket
      await services.obsStream.connect();

      // Test service connections
      await this.testServices(services);

      logger.info('Pipeline initialization complete');
      return services;
    } catch (error) {
      logger.error(
        `Pipeline initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private createEvaluatorService() {
    return this.config.testMode
      ? new TestMessageEvaluator(this.config)
      : new MessageEvaluator(this.config);
  }

  private createTextGeneratorService() {
    return this.config.testMode
      ? new TestTextGenerator(this.config)
      : new TextGenerator(this.config);
  }

  private createTTSService(): TTSService {
    if (this.config.testMode) {
      return new TestTTS(this.config);
    }
    if (this.config.useElevenLabs) {
      return new ElevenLabsTTS(this.config);
    }
    if (this.config.useZonosTTSLocal) {
      return new ZonosTTS(this.config);
    }
    if (this.config.useZonosTTSAPI) {
      return new ZonosTTSAPI(this.config);
    }
    // Default to ZonosTTS if no service specified
    return new ZonosTTS(this.config);
  }

  private createSyncService(): VideoSyncService {
    if (this.config.testMode) {
      return new TestVideoSync(this.config);
    }
    if (this.config.useFalLatentSync) {
      return new FalLatentSync(this.config);
    }
    if (this.config.useSyncLabs) {
      return new SyncLabsSync(this.config);
    }
    return new LocalLatentSync(this.config);
  }

  private createOBSService(): OBSStream {
    return new OBSStream(this.config);
  }

  /**
   * Test service connections
   */
  async testServices(services: PipelineServices): Promise<void> {
    await this.testTextGeneratorService(services.textGenerator);
    await this.testTTSService(services.tts);
    await this.testSyncService(services.sync);
    await this.testOBSService(services.obsStream);
  }

  private async testTextGeneratorService(textGenerator: {
    testConnection(): Promise<boolean>;
  }): Promise<void> {
    try {
      await textGenerator.testConnection();
      logger.info('Text generation service connection verified');
    } catch (error) {
      logger.warn(
        `Text generation service warning: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async testTTSService(tts: TTSService): Promise<void> {
    try {
      await tts.testConnection();
      logger.info('TTS service connection verified');
    } catch (error) {
      logger.warn(
        `TTS service connection warning: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async testSyncService(sync: VideoSyncService): Promise<void> {
    try {
      await sync.testConnection();
      logger.info('Video sync service connection verified');
    } catch (error) {
      logger.warn(
        `Video sync service connection warning: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private testOBSService(obsStream?: OBSStream): Promise<void> {
    if (!obsStream) {
      return Promise.resolve();
    }

    try {
      if (obsStream.isConnected()) {
        logger.info('OBS WebSocket connection verified');
      } else {
        logger.warn('OBS WebSocket connection not established');
      }
    } catch (error) {
      logger.warn(
        `OBS WebSocket connection warning: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return Promise.resolve();
  }
}
