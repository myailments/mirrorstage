// app.ts - Main application for Lambda Cloud AI Video Pipeline
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config.ts';
import { logger } from './utils/logger.ts';
import { PipelineInitializer } from './services/PipelineInitializer.ts';
import { StreamAnalyzer } from './services/StreamAnalyzer.ts';
import { 
  Config, 
  PipelineItem, 
  PipelineStatus, 
  CompletedVideo,
  PipelineStatusSummary,
  InputResponse,
  StreamAnalysisResult,
} from './types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

class AIPipeline {
  config: Config;
  pipeline: Map<string, PipelineItem>;
  fileManager: any;
  evaluator: any;
  textGenerator: any;
  tts: any;
  sync: any;
  obsStream: any;
  streamAnalyzer: StreamAnalyzer | null = null;
  visionInterval: NodeJS.Timeout | null = null;
  useVision: boolean = false;

  static Status = PipelineStatus;

  constructor() {
    this.config = {
      ...config,
      testMode: false,
      maxConcurrent: Math.min(config.maxConcurrent || 4, 20)
    };
    this.pipeline = new Map<string, PipelineItem>(); 
  }

  /**
   * Initialize the pipeline
   */
  async initialize(): Promise<boolean> {
    const initializer = new PipelineInitializer(this.config);
    const services = await initializer.initialize();

    // Assign services
    this.fileManager = services.fileManager;
    this.evaluator = services.evaluator;
    this.textGenerator = services.textGenerator;
    this.tts = services.tts;
    this.sync = services.sync;
    this.obsStream = services.obsStream;

    // Initialize stream analyzer if OBS is connected
    if (this.obsStream && this.obsStream.isConnected()) {
      this.streamAnalyzer = new StreamAnalyzer(this.obsStream, this.config);
      logger.info('Stream analyzer initialized');
      
      // Auto-start vision processing if enabled in config
      if (this.config.useVision) {
        this.startVisionProcessing(
          this.config.visionSourceName,
          undefined, // Use the interval from config
          this.config.visionPrompt
        ).then(success => {
          if (success) {
            logger.info(`Vision processing auto-started with ${this.config.visionIntervalSeconds} second interval`);
          } else {
            logger.error('Failed to auto-start vision processing');
          }
        }).catch(err => {
          logger.error(`Error auto-starting vision processing: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    return true;
  }

  /**
   * Handle new user input
   */
  async handleUserInput(userId: string, message: string): Promise<InputResponse> {
    const messageId = `${userId}-${Date.now()}`;
    
    // Create pipeline item
    const pipelineItem: PipelineItem = {
      messageId,
      userId,
      message,
      status: PipelineStatus.RECEIVED,
      timestamp: Date.now(),
      updates: [{
        status: PipelineStatus.RECEIVED,
        timestamp: Date.now()
      }]
    };

    this.pipeline.set(messageId, pipelineItem);
    logger.info(`New input received: ${messageId}`);

    // Start processing if capacity available
    if (this.getActiveProcessingCount() < this.config.maxConcurrent!) {
      this.processItem(pipelineItem).catch(err => 
        logger.error(`Failed to process item ${messageId}: ${err instanceof Error ? err.message : String(err)}`)
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
      timestamp: Date.now()
    });
    logger.info(`Item ${item.messageId} status: ${status}`);
  }

  /**
   * Get count of items being actively processed
   */
  getActiveProcessingCount(): number {
    return Array.from(this.pipeline.values()).filter(item => 
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
      // Evaluate
      this.updateStatus(item, PipelineStatus.EVALUATING);
      const evaluation = await this.evaluator.evaluateInputs([item]);

      if (evaluation.priority < this.config.minPriority!) {
        this.updateStatus(item, PipelineStatus.REJECTED);
        return;
      }

      // Generate response using the service
      // Add the last 5 messages to the context
      const lastMessages = Array.from(this.pipeline.values())
        .filter(i => i.status === PipelineStatus.COMPLETED)
        .map(i => i.message)
        .slice(-5);
      this.updateStatus(item, PipelineStatus.GENERATING_RESPONSE);
      const response = await this.textGenerator.generateText(item.message, lastMessages);
      item.response = response;
      logger.info(`Generated response: ${response}`);


      // Generate speech
      this.updateStatus(item, PipelineStatus.GENERATING_SPEECH);
      const audioPath = await this.tts.convert(response);
      item.audioPath = audioPath;
      logger.info(`Generated speech at: ${audioPath}`);
      
      // Generate video
      this.updateStatus(item, PipelineStatus.GENERATING_VIDEO);
      const videoPath = await this.sync.process(audioPath);
      item.videoPath = videoPath;
      logger.info(`Generated video at: ${videoPath}`);
      
      // Send video to OBS if configured
      if (this.obsStream && this.config.useOBS) {
        try {
          await this.obsStream.updateGeneratedVideoSource(videoPath);
          logger.info(`Video sent to OBS: ${videoPath}`);
        } catch (obsError) {
          logger.error(`Failed to send video to OBS: ${obsError instanceof Error ? obsError.message : String(obsError)}`);
          // Continue with normal web client pipeline even if OBS fails
        }
      }

      // Mark as completed
      this.updateStatus(item, PipelineStatus.COMPLETED);
      // Clean up files
      if (!this.config.testMode) {
        // fs.unlinkSync(audioPath);
        // fs.unlinkSync(videoPath);
      }
    } catch (error) {
      logger.error(`Pipeline error for ${item.messageId}: ${error instanceof Error ? error.message : String(error)}`);
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
    const availableSlots = this.config.maxConcurrent! - this.getActiveProcessingCount();
    if (availableSlots <= 0) return;

    // Get pending items
    const pending = Array.from(this.pipeline.values())
      .filter(item => item.status === PipelineStatus.RECEIVED)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Process up to available slots
    pending.slice(0, availableSlots).forEach(item => {
      this.processItem(item).catch(err => 
        logger.error(`Failed to process item ${item.messageId}: ${err instanceof Error ? err.message : String(err)}`)
      );
    });
  }

  /**
   * Get all completed videos ready for playback
   */
  getCompletedVideos(): CompletedVideo[] {
    return Array.from(this.pipeline.values())
      .filter((item): item is PipelineItem & { response: string, videoPath: string } => 
        item.status === PipelineStatus.COMPLETED && 
        typeof item.response === 'string' && 
        typeof item.videoPath === 'string'
      )
      .map(item => ({
        messageId: item.messageId,
        userId: item.userId,
        message: item.message,
        response: item.response,
        videoPath: item.videoPath,
        timestamp: item.timestamp
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
   * Start vision processing of screenshots from OBS
   * @param sourceName Name of the OBS source to capture (e.g. "Display Capture")
   * @param intervalSeconds How often to capture and process screenshots (in seconds)
   * @param customPrompt Optional custom prompt for vision analysis
   */
  async startVisionProcessing(
    sourceName: string = 'Display Capture',
    intervalSeconds?: number,
    customPrompt?: string
  ): Promise<boolean> {
    if (!this.obsStream || !this.obsStream.isConnected()) {
      logger.error('Cannot start vision processing: OBS is not connected');
      return false;
    }

    if (!this.streamAnalyzer) {
      this.streamAnalyzer = new StreamAnalyzer(this.obsStream, this.config);
      logger.info('Stream analyzer initialized');
    }

    // Use the interval from config if not specified
    const effectiveIntervalSeconds = intervalSeconds ?? (this.config.visionIntervalSeconds || 30);
    const intervalMs = effectiveIntervalSeconds * 1000;
    
    const success = await this.streamAnalyzer.startAnalyzing(
      sourceName,
      intervalMs,
      customPrompt
    );

    if (!success) {
      logger.error(`Failed to start vision processing from source "${sourceName}"`);
      return false;
    }

    // Register for analysis events
    this.streamAnalyzer.on('analysis', this.handleVisionAnalysis.bind(this));

    // Clear any existing interval
    if (this.visionInterval) {
      clearInterval(this.visionInterval);
      this.visionInterval = null;
    }
    
    // Set up interval to process vision data with the same frequency
    logger.info(`Setting up vision processing interval with frequency ${intervalMs}ms`);
    this.visionInterval = setInterval(() => {
      logger.info(`Scheduled vision processing triggered at ${new Date().toISOString()}`);
      this.processLatestVisionData();
    }, intervalMs);

    this.useVision = true;
    logger.info(`Vision processing started. Will capture and generate videos every ${effectiveIntervalSeconds} seconds`);
    return true;
  }

  /**
   * Stop vision processing
   */
  stopVisionProcessing(): void {
    logger.info('Stopping vision processing...');
    
    if (this.streamAnalyzer) {
      this.streamAnalyzer.stopAnalyzing();
      this.streamAnalyzer.removeAllListeners('analysis');
    }

    if (this.visionInterval) {
      logger.info('Clearing vision processing interval');
      clearInterval(this.visionInterval);
      this.visionInterval = null;
    }

    this.useVision = false;
    logger.info('Vision processing stopped');
  }

  /**
   * Handle vision analysis results
   */
  private handleVisionAnalysis(result: StreamAnalysisResult): void {
    logger.info(`Received vision analysis: ${result.analysis.description.substring(0, 100)}...`);
    // The processLatestVisionData method will handle processing this data on the interval
  }

  /**
   * Process the latest vision data and generate a video
   */
  private async processLatestVisionData(): Promise<void> {
    if (!this.streamAnalyzer || !this.useVision) return;

    try {
      // Get the latest analysis result
      const analysisResult = this.streamAnalyzer.getLastAnalysisResult();
      if (!analysisResult) {
        logger.warn('No analysis result available for vision processing');
        return;
      }

      const description = analysisResult.analysis.description;
      logger.info(`Processing vision data: ${description.substring(0, 100)}...`);

      // Create a pipeline item from the vision data
      const messageId = `vision-${Date.now()}`;
      const visionItem: PipelineItem = {
        messageId,
        userId: 'vision-system',
        message: `You are a livestreamer. This is what you see in the video: ${description}`,
        status: PipelineStatus.RECEIVED,
        timestamp: Date.now(),
        updates: [{
          status: PipelineStatus.RECEIVED,
          timestamp: Date.now()
        }]
      };

      // Add to pipeline and process
      this.pipeline.set(messageId, visionItem);
      logger.info(`Vision item added to pipeline: ${messageId}`);
      if (this.getActiveProcessingCount() < this.config.maxConcurrent!) {
        this.processItem(visionItem).catch(err => 
          logger.error(`Failed to process vision item ${messageId}: ${err instanceof Error ? err.message : String(err)}`)
        );
      }
    } catch (error) {
      logger.error(`Error processing vision data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get detailed pipeline status
   */
  getStatus(): PipelineStatusSummary {
    const items = Array.from(this.pipeline.values());
    
    // Initialize all status counts
    const countByStatus = Object.values(PipelineStatus).reduce((acc, status) => {
      acc[status] = items.filter(item => item.status === status).length;
      return acc;
    }, {} as Record<PipelineStatus, number>);

    return {
      activeProcessing: this.getActiveProcessingCount(),
      maxConcurrent: this.config.maxConcurrent!,
      totalItems: items.length,
      statusCounts: countByStatus,
      recentUpdates: items
        .filter(item => item.updates.length > 0)
        .slice(-10)
        .map(item => ({
          messageId: item.messageId,
          status: item.status,
          lastUpdate: item.updates[item.updates.length - 1].timestamp
        }))
    };
  }
}

// Initialize pipeline
const pipeline = new AIPipeline();

// Add CLI input handling
if (process.argv.includes('--cli')) {
  import('readline/promises').then(({ createInterface }) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const processCLIInput = async (): Promise<void> => {
      try {
        const input = await readline.question('Enter message (or "exit" to quit): ');
        
        if (input.toLowerCase() === 'exit') {
          readline.close();
          process.exit(0);
        }

        const result = await pipeline.handleUserInput('cli-user', input);
        logger.info(`Processing message ${result.messageId}`);
        
        // Wait briefly before asking for next input to allow status logging
        setTimeout(processCLIInput, 500);
      } catch (error) {
        logger.error(`CLI input error: ${error instanceof Error ? error.message : String(error)}`);
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
        logger.error(`Failed to initialize pipeline: ${error instanceof Error ? error.message : String(error)}`);
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
      const server = app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        logger.info('Shutting down server...');
        
        // Stop vision processing if active
        if (pipeline.useVision) {
          pipeline.stopVisionProcessing();
        }
        
        // Disconnect from OBS if connected
        if (pipeline.obsStream) {
          await pipeline.obsStream.disconnect();
        }
        
        server.close(() => {
          logger.info('Server stopped');
          process.exit(0);
        });
      });
    } catch (error) {
      logger.error(`Failed to initialize pipeline: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  })();
}
