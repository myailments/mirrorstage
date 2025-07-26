import 'dotenv/config';
import fs from 'node:fs';
import express from 'express';
import config from './config';
import { ConversationMemory } from './services/ConversationMemory';
import {
  PipelineInitializer,
  type PipelineServices,
} from './services/PipelineInitializer';
import { VisionProcessor } from './services/VisionProcessor';
import {
  type CompletedVideo,
  type Config,
  type InputResponse,
  type PipelineItem,
  PipelineStatus,
  type PipelineStatusSummary,
} from './types/index';
import { logger } from './utils/logger';

// Initialize Express app
const app = express();
app.use(express.json());

/**
 * AIPipeline - Main orchestration class for the AI video generation pipeline
 *
 * This class manages the entire pipeline from receiving user input to generating
 * video responses. It coordinates between different services (text generation,
 * TTS, video sync, etc.) and manages the processing queue.
 */
class AIPipeline {
  /** Configuration for the pipeline and all services */
  config: Config;

  /** Map of all messages/items in the pipeline, keyed by messageId */
  pipeline: Map<string, PipelineItem>;

  /** Container for all pipeline services */
  services?: PipelineServices;

  /** Service for processing vision/screenshots */
  visionProcessor: VisionProcessor | null = null;

  /** Flag indicating if vision processing is enabled */
  useVision = false;

  /** Interval handler for thought generation */
  thoughtInterval: NodeJS.Timeout | null = null;

  /** Flag indicating if thought generation is enabled */
  useThoughts = false;

  /** Track the last generated text for ElevenLabs TTS context */
  lastGeneratedText = '';

  /** Conversation memory for tracking all interactions */
  conversationMemory: ConversationMemory;

  /** Expose pipeline status enum for external use */
  static Status = PipelineStatus;

  constructor() {
    this.config = {
      ...config,
      testMode: false,
    };
    this.pipeline = new Map<string, PipelineItem>();
    this.conversationMemory = new ConversationMemory(
      1000,
      100,
      './data',
      this.config
    );
  }

  /**
   * Initialize the pipeline
   */
  async initialize(): Promise<boolean> {
    const initializer = new PipelineInitializer(this.config);
    this.services = await initializer.initialize();

    // Set conversation memory for text and thought generators
    if (this.services) {
      this.services.textGenerator.setConversationMemory(
        this.conversationMemory
      );
      this.services.thoughtGenerator.setConversationMemory(
        this.conversationMemory
      );
    }

    // Initialize vision processor if OBS is connected and vision is enabled
    if (this.services.obsStream?.isConnected() && this.config.useVision) {
      this.visionProcessor = new VisionProcessor(
        this.services.obsStream,
        this.config
      );

      // Set up vision response handler
      this.visionProcessor.on(
        'visionResponse',
        this.handleVisionResponse.bind(this)
      );

      // Start vision processing
      const success = await this.visionProcessor.start();
      if (success) {
        this.useVision = true;
        logger.info(
          `Vision processing started with ${this.config.visionIntervalSeconds || 30} second interval`
        );
      } else {
        logger.error('Failed to start vision processing');
      }
    }

    // Initialize message ingestion service if enabled
    if (this.services.messageIngestion) {
      try {
        logger.info('Initializing message ingestion service...');

        // Connect to the service
        const connected = await this.services.messageIngestion.connect();
        if (connected) {
          logger.info('Message ingestion service connected successfully');

          // Set up message handler
          this.services.messageIngestion.onMessage(
            this.handleIncomingMessage.bind(this)
          );

          // Start listening for messages
          await this.services.messageIngestion.startListening();
          logger.info(
            'Message ingestion service started listening for messages'
          );
        } else {
          logger.error('Failed to connect to message ingestion service');
        }
      } catch (error) {
        logger.error(
          `Error initializing message ingestion service: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Initialize thought generation if enabled
    if (this.useThoughts && this.services.thoughtGenerator) {
      this.startThoughtGeneration();
    }

    return true;
  }

  /**
   * Start automatic thought generation every 30 seconds
   */
  startThoughtGeneration(): void {
    if (this.thoughtInterval) {
      clearInterval(this.thoughtInterval);
    }

    logger.info('Starting thought generation with 30-second interval');

    this.thoughtInterval = setInterval(() => {
      this.generateThoughtVideo().catch((error) => {
        logger.error(
          `Error generating thought video: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, 30_000); // 30 seconds

    // Generate the first thought immediately
    this.generateThoughtVideo().catch((error) => {
      logger.error(
        `Error generating initial thought video: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  /**
   * Stop automatic thought generation
   */
  stopThoughtGeneration(): void {
    if (this.thoughtInterval) {
      logger.info('Stopping thought generation');
      clearInterval(this.thoughtInterval);
      this.thoughtInterval = null;
    }
  }

  /**
   * Generate a thought and process it directly through TTS and video pipeline
   */
  private async generateThoughtVideo(): Promise<void> {
    if (!this.services) {
      logger.warn('Services not initialized');
      return;
    }

    if (
      !(
        this.services.thoughtGenerator &&
        this.services.tts &&
        this.services.sync
      )
    ) {
      logger.warn('Required services not available for thought generation');
      return;
    }

    // Check if we have capacity for processing
    if (this.getActiveProcessingCount() >= (this.config.maxConcurrent || 1)) {
      logger.info('Pipeline at capacity, skipping thought generation');
      return;
    }

    try {
      // Generate a unique thought
      const thought = await this.services.thoughtGenerator.generateThought();

      // Track thought in conversation memory
      await this.conversationMemory.addEntry('thought', thought);

      // Create a pipeline item for tracking
      const messageId = `thought-${Date.now()}`;
      const thoughtItem: PipelineItem = {
        messageId,
        userId: 'thought-system',
        message: 'Generated thought',
        response: thought,
        status: PipelineStatus.GENERATING_SPEECH,
        timestamp: Date.now(),
        updates: [
          {
            status: PipelineStatus.RECEIVED,
            timestamp: Date.now(),
          },
          {
            status: PipelineStatus.GENERATING_SPEECH,
            timestamp: Date.now(),
          },
        ],
      };

      this.pipeline.set(messageId, thoughtItem);
      logger.info(
        `Processing thought directly through TTS: ${thought.substring(0, 50)}...`
      );

      // Generate speech directly from thought
      const audioPath = await this.services.tts.convert(
        thought,
        this.lastGeneratedText
      );
      thoughtItem.audioPath = audioPath;
      this.updateStatus(thoughtItem, PipelineStatus.GENERATING_VIDEO);
      logger.info(`Generated speech for thought at: ${audioPath}`);

      // Update last generated text
      this.lastGeneratedText = thought;

      // Generate video
      const videoPath = await this.services.sync.process(audioPath);
      thoughtItem.videoPath = videoPath;
      this.updateStatus(thoughtItem, PipelineStatus.COMPLETED);
      logger.info(`Generated video for thought at: ${videoPath}`);

      // Send video to OBS
      if (this.services.obsStream) {
        try {
          await this.services.obsStream.updateGeneratedVideoSource(videoPath);
          logger.info(`Thought video sent to OBS: ${videoPath}`);
        } catch (obsError) {
          logger.error(
            `Failed to send thought video to OBS: ${obsError instanceof Error ? obsError.message : String(obsError)}`
          );
        }
      }

      // Clean up files
      if (!this.config.testMode) {
        fs.unlinkSync(audioPath);
        fs.unlinkSync(videoPath);
      }
    } catch (error) {
      logger.error(
        `Error in generateThoughtVideo: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle new user input
   */
  handleUserInput(userId: string, message: string): InputResponse {
    const messageId = `${userId}-${Date.now()}`;

    // Track user message in conversation memory asynchronously (don't block)
    this.conversationMemory
      .addEntry('user_message', message, userId)
      .catch((err) =>
        logger.error(`Failed to add user message to memory: ${err}`)
      );

    // Create pipeline item
    const pipelineItem: PipelineItem = {
      messageId,
      userId,
      message,
      status: PipelineStatus.RECEIVED,
      timestamp: Date.now(),
      updates: [
        {
          status: PipelineStatus.RECEIVED,
          timestamp: Date.now(),
        },
      ],
    };

    this.pipeline.set(messageId, pipelineItem);
    logger.info(`New input received: ${messageId}`);

    // Start processing if capacity available
    if (this.getActiveProcessingCount() < this.config.maxConcurrent || 0) {
      this.processItem(pipelineItem).catch((err) =>
        logger.error(
          `Failed to process item ${messageId}: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }

    return { messageId, status: PipelineStatus.RECEIVED };
  }

  /**
   * Update item status with timestamp
   */
  updateStatus(item: PipelineItem, status: PipelineStatus): void {
    item.status = status;
    item.updates.push({
      status,
      timestamp: Date.now(),
    });
    logger.info(`Item ${item.messageId} status: ${status}`);
  }

  /**
   * Get count of items being actively processed
   */
  getActiveProcessingCount(): number {
    return Array.from(this.pipeline.values()).filter(
      (item) =>
        item.status !== PipelineStatus.RECEIVED &&
        item.status !== PipelineStatus.COMPLETED &&
        item.status !== PipelineStatus.REJECTED &&
        item.status !== PipelineStatus.FAILED
    ).length;
  }

  /**
   * Process a single item through the pipeline
   */
  async processItem(item: PipelineItem): Promise<void> {
    try {
      if (!this.services) {
        throw new Error('Pipeline services not initialized');
      }

      // Evaluate
      this.updateStatus(item, PipelineStatus.EVALUATING);
      logger.info(`Evaluating message: ${item.message}`);
      const evaluations = await this.services.evaluator.evaluateInputs([item]);
      const evaluation = evaluations[0];
      logger.info(
        `Evaluation priority: ${evaluation.priority}, min required: ${this.config.minPriority}`
      );
      if (evaluation.priority < this.config.minPriority) {
        this.updateStatus(item, PipelineStatus.REJECTED);
        return;
      }

      // Generate response using the service
      this.updateStatus(item, PipelineStatus.GENERATING_RESPONSE);
      const response = await this.services.textGenerator.generateText(
        item.message,
        undefined,
        item.userId
      );
      item.response = response;
      logger.info(`Generated response: ${response}`);

      // Track bot response in conversation memory
      await this.conversationMemory.addEntry(
        'bot_response',
        response,
        item.userId
      );

      // Generate speech
      this.updateStatus(item, PipelineStatus.GENERATING_SPEECH);
      const audioPath = await this.services.tts.convert(
        response,
        this.lastGeneratedText
      );
      item.audioPath = audioPath;
      logger.info(`Generated speech at: ${audioPath}`);

      // Update last generated text
      this.lastGeneratedText = response;

      // Generate video
      this.updateStatus(item, PipelineStatus.GENERATING_VIDEO);
      const videoPath = await this.services.sync.process(audioPath);
      item.videoPath = videoPath;
      logger.info(`Generated video at: ${videoPath}`);

      // Send video to OBS
      if (this.services.obsStream) {
        try {
          await this.services.obsStream.updateGeneratedVideoSource(videoPath);
          logger.info(`Video sent to OBS: ${videoPath}`);
        } catch (obsError) {
          logger.error(
            `Failed to send video to OBS: ${obsError instanceof Error ? obsError.message : String(obsError)}`
          );
        }
      } else {
        logger.error(
          'OBS stream service not initialized. Cannot send video to OBS.'
        );
      }

      // Mark as completed
      this.updateStatus(item, PipelineStatus.COMPLETED);
      // Clean up files
      if (!this.config.testMode) {
        fs.unlinkSync(audioPath);
        fs.unlinkSync(videoPath);
      }
    } catch (error) {
      logger.error(
        `Pipeline error for ${item.messageId}: ${error instanceof Error ? error.message : String(error)}`
      );
      this.updateStatus(item, PipelineStatus.FAILED);
      item.error = error instanceof Error ? error.message : String(error);
    }

    // Start processing next item if available
    this.processNextItems();
  }

  /**
   * Process next items if capacity available
   */
  processNextItems(): void {
    const availableSlots =
      this.config.maxConcurrent - this.getActiveProcessingCount();
    if (availableSlots <= 0) {
      return;
    }

    // Get pending items
    const pending = Array.from(this.pipeline.values())
      .filter((item) => item.status === PipelineStatus.RECEIVED)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Process up to available slots
    for (const item of pending.slice(0, availableSlots)) {
      this.processItem(item).catch((err) =>
        logger.error(
          `Failed to process item ${item.messageId}: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  /**
   * Get all completed videos ready for playback
   */
  getCompletedVideos(): CompletedVideo[] {
    return Array.from(this.pipeline.values())
      .filter(
        (
          item
        ): item is PipelineItem & { response: string; videoPath: string } =>
          item.status === PipelineStatus.COMPLETED &&
          typeof item.response === 'string' &&
          typeof item.videoPath === 'string'
      )
      .map((item) => ({
        messageId: item.messageId,
        userId: item.userId,
        message: item.message,
        response: item.response,
        videoPath: item.videoPath,
        timestamp: item.timestamp,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Mark video as played
   */
  markVideoPlayed(messageId: string): boolean {
    const item = this.pipeline.get(messageId);
    if (item?.status === PipelineStatus.COMPLETED && item.videoPath) {
      // !this.config.testMode && fs.unlinkSync(item.videoPath);
      this.pipeline.delete(messageId);
      return true;
    }
    return false;
  }

  /**
   * Handle vision responses from the VisionProcessor - processes directly through TTS/video
   */
  private async handleVisionResponse(visionData: {
    description: string;
    response: string;
    timestamp: string;
  }): Promise<void> {
    if (!(this.useVision && this.services)) {
      return;
    }

    try {
      logger.info(
        `Vision response received: ${visionData.response.substring(0, 100)}...`
      );

      // Check if we have capacity for processing
      if (this.getActiveProcessingCount() >= (this.config.maxConcurrent || 1)) {
        logger.info('Pipeline at capacity, skipping vision response');
        return;
      }

      // Track vision observation in conversation memory
      await this.conversationMemory.addEntry(
        'vision_observation',
        visionData.response,
        undefined,
        { description: visionData.description }
      );

      // Create a pipeline item for tracking
      const messageId = `vision-${Date.now()}`;
      const visionItem: PipelineItem = {
        messageId,
        userId: 'vision-system',
        message: `Vision detected: ${visionData.description}`,
        response: visionData.response,
        status: PipelineStatus.GENERATING_SPEECH,
        timestamp: Date.now(),
        updates: [
          {
            status: PipelineStatus.GENERATING_SPEECH,
            timestamp: Date.now(),
          },
        ],
      };

      this.pipeline.set(messageId, visionItem);
      logger.info(
        `Processing vision response directly through TTS: ${visionData.response.substring(0, 50)}...`
      );

      // Generate speech directly from response
      const audioPath = await this.services.tts.convert(
        visionData.response,
        this.lastGeneratedText
      );
      visionItem.audioPath = audioPath;
      this.updateStatus(visionItem, PipelineStatus.GENERATING_VIDEO);
      logger.info(`Generated speech for vision response at: ${audioPath}`);

      // Update last generated text
      this.lastGeneratedText = visionData.response;

      // Generate video
      const videoPath = await this.services.sync.process(audioPath);
      visionItem.videoPath = videoPath;
      this.updateStatus(visionItem, PipelineStatus.COMPLETED);
      logger.info(`Generated video for vision response at: ${videoPath}`);

      // Send video to OBS
      if (this.services.obsStream) {
        try {
          await this.services.obsStream.updateGeneratedVideoSource(videoPath);
          logger.info(`Sent vision response video to OBS: ${videoPath}`);
        } catch (obsError) {
          logger.error(
            `Failed to send vision video to OBS: ${obsError instanceof Error ? obsError.message : String(obsError)}`
          );
        }
      }

      // Clean up files
      if (!this.config.testMode) {
        fs.unlinkSync(audioPath);
        fs.unlinkSync(videoPath);
      }
    } catch (error) {
      logger.error(
        `Error handling vision response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Stop vision processing
   */
  stopVisionProcessing(): void {
    if (!this.visionProcessor) {
      return;
    }

    logger.info('Stopping vision processing...');
    this.visionProcessor.stop();
    this.visionProcessor.removeAllListeners('visionResponse');
    this.visionProcessor = null;
    this.useVision = false;
    logger.info('Vision processing stopped');
  }

  /**
   * Handle incoming messages from message ingestion services (e.g., PumpFun)
   */
  private handleIncomingMessage(message: {
    userId: string;
    username: string;
    message: string;
    timestamp: number;
    source: string;
  }): void {
    try {
      logger.info(
        `Received message from ${message.source}: [${message.username}] ${message.message}`
      );

      // Create a formatted message for the AI pipeline
      const formattedMessage = `Message from ${message.username} on ${message.source}: ${message.message}`;

      // Process the message through the pipeline
      this.handleUserInput(message.userId, formattedMessage);
    } catch (error) {
      logger.error(
        `Error handling incoming message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get detailed pipeline status
   */
  getStatus(): PipelineStatusSummary {
    const items = Array.from(this.pipeline.values());

    // Initialize all status counts
    const countByStatus = Object.values(PipelineStatus).reduce(
      (acc, status) => {
        acc[status] = items.filter((item) => item.status === status).length;
        return acc;
      },
      {} as Record<PipelineStatus, number>
    );

    return {
      activeProcessing: this.getActiveProcessingCount(),
      maxConcurrent: this.config.maxConcurrent,
      totalItems: items.length,
      statusCounts: countByStatus,
      recentUpdates: items
        .filter((item) => item.updates.length > 0)
        .slice(-10)
        .map((item) => ({
          messageId: item.messageId,
          status: item.status,
          lastUpdate: item.updates.at(-1)?.timestamp || 0,
        })),
    };
  }
}

// Initialize pipeline
const pipeline = new AIPipeline();

// Add CLI input handling
if (process.argv.includes('--cli')) {
  import('node:readline/promises').then(({ createInterface }) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const processCLIInput = async (): Promise<void> => {
      try {
        const input = await readline.question(
          'Enter message (or "exit" to quit): '
        );

        if (input.toLowerCase() === 'exit') {
          readline.close();
          process.exit(0);
        }

        const result = pipeline.handleUserInput('cli-user', input);
        logger.info(`Processing message ${result.messageId}`);

        // Wait briefly before asking for next input to allow status logging
        setTimeout(processCLIInput, 500);
      } catch (error) {
        logger.error(
          `CLI input error: ${error instanceof Error ? error.message : String(error)}`
        );
        processCLIInput();
      }
    };

    // Initialize CLI mode after pipeline is ready
    (async () => {
      try {
        await pipeline.initialize();
        logger.info('CLI mode activated - ready for input');
        processCLIInput();
      } catch (error) {
        logger.error(
          `Failed to initialize pipeline: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    })();
  });
} else {
  // Original server initialization
  (async () => {
    try {
      await pipeline.initialize();

      // Start server
      const PORT = process.env.PORT || 3000;
      const server = app.listen(PORT, () =>
        logger.info(`Server running on port ${PORT}`)
      );

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        logger.info('Shutting down server...');

        // // Stop vision processing if active
        // if (pipeline.useVision) {
        //   pipeline.stopVisionProcessing();
        // }

        // Stop thought generation if active
        if (pipeline.useThoughts) {
          pipeline.stopThoughtGeneration();
        }

        // Disconnect from OBS if connected
        if (pipeline.services?.obsStream) {
          await pipeline.services.obsStream.disconnect();
        }

        server.close(() => {
          logger.info('Server stopped');
          process.exit(0);
        });
      });
    } catch (error) {
      logger.error(
        `Failed to initialize pipeline: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  })();
}
