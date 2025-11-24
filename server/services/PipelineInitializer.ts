import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { FileManager } from './FileManager.js';
import type { MessageIngestionService, VideoSyncService } from './interfaces.js';
import { InworldService } from './InworldService.js';
import { OBSStream } from './OBSStream.js';
import { PumpFunMessages } from './PumpFunMessages.js';
import { TestVideoSync, VideoSync } from './VideoSync.js';

export interface PipelineServices {
  fileManager: FileManager;
  inworld: InworldService;
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

      // Initialize services
      const services: PipelineServices = {
        fileManager,
        inworld: this.createInworldService(),
        sync: this.createSyncService(),
        obsStream: this.createOBSService(),
        messageIngestion: this.createMessageIngestionService(),
      };

      // Initialize Inworld service
      await services.inworld.initialize();

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

  private createInworldService(): InworldService {
    return new InworldService(this.config);
  }

  private createSyncService(): VideoSyncService {
    if (this.config.testMode) {
      return new TestVideoSync(this.config);
    }
    return new VideoSync(this.config);
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
    await this.testInworldService(services.inworld);
    await this.testSyncService(services.sync);
    await this.testOBSService(services.obsStream);
    this.testMessageIngestionService(services.messageIngestion);
  }

  private async testInworldService(inworld: InworldService): Promise<void> {
    try {
      await inworld.testConnection();
      logger.info('Inworld service connection verified');
    } catch (error) {
      logger.warn(
        `Inworld service warning: ${error instanceof Error ? error.message : String(error)}`
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
