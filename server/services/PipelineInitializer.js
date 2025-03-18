import { logger } from '../utils/logger.js';
import { FileManager } from './FileManager.js';
import { MessageEvaluator } from './Evaluator.js';
import { ZonosTTS, ElevenLabsTTS } from './TTS.js';
import { LocalLatentSync, FalLatentSync } from './VideoSync.js';
import { TextGenerator } from './TextGenerator.js';

export class PipelineInitializer {
  constructor(config) {
    this.config = config;
  }

  /**
   * Initialize all pipeline components
   */
  async initialize() {
    try {
      // Initialize file manager
      const fileManager = new FileManager(this.config);
      await fileManager.initializeDirectories();
      fileManager.verifyBaseVideo();


      // Initialize services
      const services = {
        fileManager,
        evaluator: new MessageEvaluator(),
        textGenerator: new TextGenerator(this.config),
        tts: this.config.useElevenLabs ? 
          new ElevenLabsTTS(this.config) : 
          new ZonosTTS(this.config),
        sync: this.config.useFalLatentSync ? 
          new FalLatentSync(this.config) : 
          new LocalLatentSync(this.config)
      };
      

      // Test service connections
      await this.testServices(services);

      logger.info('Pipeline initialization complete');
      return services;

    } catch (error) {
      logger.error(`Pipeline initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Test service connections
   */
  async testServices(services) {
    // Test text generation service
    try {
      await services.textGenerator.testConnection();
      logger.info('Text generation service connection verified');
    } catch (error) {
      logger.warn(`Text generation service warning: ${error.message}`);
    }

    // Test TTS service
    try {
      await services.tts.testConnection();
      logger.info('TTS service connection verified');
    } catch (error) {
      logger.warn(`TTS service connection warning: ${error.message}`);
    }

    // Test Sync service
    try {
      await services.sync.testConnection();
      logger.info('Video sync service connection verified');
    } catch (error) {
      logger.warn(`Video sync service connection warning: ${error.message}`);
    }
  }
} 