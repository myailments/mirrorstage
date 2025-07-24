import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { MessageEvaluator, TestMessageEvaluator } from './Evaluator.js';
import { FileManager } from './FileManager.js';
import type {
  MessageIngestionService,
  TTSService,
  VideoSyncService,
} from './interfaces.js';
import { OBSStream } from './OBSStream.js';
import { PumpFunMessages } from './PumpFunMessages.js';
import { TestTextGenerator, TextGenerator } from './TextGenerator.js';
import { ThoughtGenerator } from './ThoughtGenerator.js';
import { ElevenLabsTTS, TestTTS, ZonosTTS, ZonosTTSAPI } from './TTS.js';
import {
  FalCreatifySync,
  FalLatentSync,
  FalPixverseSync,
  LocalLatentSync,
  SyncLabsSync,
  TestVideoSync,
} from './VideoSync.js';

export interface PipelineServices {
  fileManager: FileManager;
  evaluator: MessageEvaluator;
  textGenerator: TextGenerator;
  thoughtGenerator: ThoughtGenerator;
  tts: TTSService;
  sync: VideoSyncService;
  obsStream: OBSStream;
  messageIngestion?: MessageIngestionService;
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
        thoughtGenerator: this.createThoughtGeneratorService(),
        tts: this.createTTSService(),
        sync: this.createSyncService(),
        obsStream: this.createOBSService(),
        messageIngestion: this.createMessageIngestionService(),
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

  private createThoughtGeneratorService() {
    return new ThoughtGenerator(this.config);
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
    if (this.config.useFalPixverse) {
      return new FalPixverseSync(this.config);
    }
    if (this.config.useFalCreatify) {
      return new FalCreatifySync(this.config);
    }
    if (this.config.useSyncLabs) {
      return new SyncLabsSync(this.config);
    }
    return new LocalLatentSync(this.config);
  }

  private createOBSService(): OBSStream {
    return new OBSStream(this.config);
  }

  private createMessageIngestionService(): MessageIngestionService | undefined {
    if (this.config.usePumpFun) {
      return new PumpFunMessages(this.config);
    }
    return;
  }

  /**
   * Test service connections
   */
  async testServices(services: PipelineServices): Promise<void> {
    await this.testTextGeneratorService(services.textGenerator);
    await this.testThoughtGeneratorService(services.thoughtGenerator);
    await this.testTTSService(services.tts);
    await this.testSyncService(services.sync);
    await this.testOBSService(services.obsStream);
    this.testMessageIngestionService(services.messageIngestion);
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

  private async testThoughtGeneratorService(thoughtGenerator: {
    testConnection(): Promise<boolean>;
  }): Promise<void> {
    try {
      await thoughtGenerator.testConnection();
      logger.info('Thought generation service connection verified');
    } catch (error) {
      logger.warn(
        `Thought generation service warning: ${error instanceof Error ? error.message : String(error)}`
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

  private testMessageIngestionService(
    messageIngestion?: MessageIngestionService
  ): void {
    if (!messageIngestion) {
      return;
    }

    try {
      if (messageIngestion.isConnected()) {
        logger.info('Message ingestion service connection verified');
      } else {
        logger.warn('Message ingestion service not connected');
      }
    } catch (error) {
      logger.warn(
        `Message ingestion service connection warning: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
