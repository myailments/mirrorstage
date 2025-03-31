// app.ts - Main application for Lambda Cloud AI Video Pipeline
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config.ts';
import { logger } from './utils/logger.ts';
import { PipelineInitializer } from './services/PipelineInitializer.ts';
import { 
  Config, 
  PipelineItem, 
  PipelineStatus, 
  CompletedVideo,
  PipelineStatusSummary,
  InputResponse,
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

  static Status = PipelineStatus;

  constructor() {
    this.config = {
      ...config,
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
      const evaluated = evaluation[0];

      if (evaluated.priority < this.config.minPriority!) {
        this.updateStatus(item, PipelineStatus.REJECTED);
        return;
      }

      // Generate response using the service
      this.updateStatus(item, PipelineStatus.GENERATING_RESPONSE);
      const response = await this.textGenerator.generateText(item.message);
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
      app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
    } catch (error) {
      logger.error(`Failed to initialize pipeline: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  })();
}

// Express routes - using explicit string routes to fix type issues
app.post('/input', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const result = await pipeline.handleUserInput(userId, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/status', (req, res) => {
  res.json(pipeline.getStatus());
});

// base video
app.get('/base-video', function baseVideoHandler(req, res) {
  // Convert the relative path to an absolute path
  const videoPath = path.resolve(__dirname, '..', pipeline.config.baseVideoPath.replace(/^\.\//, ''));
  
  // Check if the file exists
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Base video file not found' });
  }
  
  // Send the file
  res.sendFile(videoPath);
});

app.get('/next-video', (req, res) => {
  const videos = pipeline.getCompletedVideos();
  if (videos.length === 0) {
    res.status(404).json({ error: 'No videos available' });
    return;
  }
  res.json(videos[0]);
});

app.post('/stream/:messageId(*)', (req, res) => {
  const messageId = req.params.messageId;
  
  const success = pipeline.markVideoPlayed(messageId);
  if (!success) {
    res.status(404).json({ error: 'Video not found or already played' });
    return;
  }
  res.json({ success: true });
});

app.get('/video/:filename(*)', (req, res) => {
  const requestedPath = req.params.filename;
  
  // Try multiple possible paths
  const possiblePaths = [
    // Path 1: Direct file in outputDir
    path.join(pipeline.config.outputDir, path.basename(requestedPath)),
    
    // Path 2: Full path appended to outputDir
    path.join(pipeline.config.outputDir, requestedPath),
    
    // Path 3: Just the path as is (if outputDir is '')
    requestedPath,
    
    // Path 4: As an absolute path from the project root
    path.resolve(requestedPath)
  ];
  
  // Try each path
  for (const tryPath of possiblePaths) {
    if (fs.existsSync(tryPath)) {
      return res.sendFile(path.resolve(tryPath));
    }
  }
  
  // If we get here, none of the paths worked
  res.status(404).json({ error: 'Video not found' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});