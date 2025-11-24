import 'dotenv/config';
import fs from 'node:fs';
import express from 'express';
import config from './config.js';
import {
  PipelineInitializer,
  type PipelineServices,
} from './services/PipelineInitializer.js';
import {
  type CompletedVideo,
  type Config,
  type InputResponse,
  type PipelineItem,
  PipelineStatus,
  type PipelineStatusSummary,
} from './types/index.js';
import { logger } from './utils/logger.js';

// Initialize Express app
const app = express();
app.use(express.json());

/**
 * AIPipeline - Main orchestration class for the AI video generation pipeline
 *
 * This class manages the entire pipeline from receiving user input to generating
 * video responses. It coordinates between Inworld AI (for text + TTS) and
 * FAL (for video sync).
 */
class AIPipeline {
  /** Configuration for the pipeline and all services */
  config: Config;

  /** Map of all messages/items in the pipeline, keyed by messageId */
  pipeline: Map<string, PipelineItem>;

  /** Container for all pipeline services */
  services?: PipelineServices;

  /** Interval handler for thought generation */
  thoughtInterval: NodeJS.Timeout | null = null;

  /** Flag indicating if thought generation is enabled */
  useThoughts = false;

  /** Expose pipeline status enum for external use */
  static Status = PipelineStatus;

  constructor() {
    this.config = {
      ...config,
      testMode: process.env.TEST_MODE === 'true',
    };
    this.pipeline = new Map<string, PipelineItem>();
  }

  /**
   * Initialize the pipeline
   */
  async initialize(): Promise<boolean> {
    const initializer = new PipelineInitializer(this.config);
    this.services = await initializer.initialize();

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
    if (this.useThoughts) {
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
   * Generate a thought and process it directly through the pipeline
   */
  private async generateThoughtVideo(): Promise<void> {
    if (!this.services) {
      logger.warn('Services not initialized');
      return;
    }

    // Check if we have capacity for processing
    if (this.getActiveProcessingCount() >= (this.config.maxConcurrent || 1)) {
      logger.info('Pipeline at capacity, skipping thought generation');
      return;
    }

    try {
      // Generate thought using Inworld (returns text + audio)
      const { text, audioPath } = await this.services.inworld.generateThought();

      // Create a pipeline item for tracking
      const messageId = `thought-${Date.now()}`;
      const thoughtItem: PipelineItem = {
        messageId,
        userId: 'thought-system',
        message: 'Generated thought',
        response: text,
        audioPath,
        status: PipelineStatus.GENERATING_VIDEO,
        timestamp: Date.now(),
        updates: [
          { status: PipelineStatus.RECEIVED, timestamp: Date.now() },
          { status: PipelineStatus.GENERATING_RESPONSE, timestamp: Date.now() },
          { status: PipelineStatus.GENERATING_SPEECH, timestamp: Date.now() },
          { status: PipelineStatus.GENERATING_VIDEO, timestamp: Date.now() },
        ],
      };

      this.pipeline.set(messageId, thoughtItem);
      logger.info(`Processing thought: ${text.slice(0, 50)}...`);

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
    if (this.getActiveProcessingCount() < (this.config.maxConcurrent || 1)) {
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

      // Evaluate message priority using Inworld
      this.updateStatus(item, PipelineStatus.EVALUATING);
      logger.info(`Evaluating message: ${item.message}`);
      const priority = await this.services.inworld.evaluateMessage(item.message);
      logger.info(`Evaluation priority: ${priority}, min required: ${this.config.minPriority}`);
      
      if (priority < this.config.minPriority) {
        this.updateStatus(item, PipelineStatus.REJECTED);
        return;
      }

      // Generate response and audio using Inworld (single call)
      this.updateStatus(item, PipelineStatus.GENERATING_RESPONSE);
      const { text, audioPath } = await this.services.inworld.generate(
        item.message,
        item.userId
      );
      item.response = text;
      item.audioPath = audioPath;
      logger.info(`Generated response: ${text}`);

      // Update status to show speech is done (it was generated with text)
      this.updateStatus(item, PipelineStatus.GENERATING_SPEECH);
      logger.info(`Generated speech at: ${audioPath}`);

      // Skip video sync in test mode
      if (this.config.testMode) {
        logger.info('Test mode: Skipping video sync and OBS');
        logger.info(`Test mode: Audio file kept at: ${audioPath}`);
        this.updateStatus(item, PipelineStatus.COMPLETED);
        // Keep audio file for testing - don't delete
        return;
      }

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
      fs.unlinkSync(audioPath);
      fs.unlinkSync(videoPath);
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
      this.pipeline.delete(messageId);
      return true;
    }
    return false;
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

  /**
   * Shutdown the pipeline gracefully
   */
  async shutdown(): Promise<void> {
    // Stop thought generation if active
    if (this.useThoughts) {
      this.stopThoughtGeneration();
    }

    // Disconnect from OBS if connected
    if (this.services?.obsStream) {
      await this.services.obsStream.disconnect();
    }

    // Stop Inworld service
    if (this.services?.inworld) {
      await this.services.inworld.stop();
    }
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
          await pipeline.shutdown();
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
        await pipeline.shutdown();
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
