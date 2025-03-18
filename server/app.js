// app.js - Main application for Lambda Cloud AI Video Pipeline
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { logger } from './utils/logger.js';
import { PipelineInitializer } from './services/PipelineInitializer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

class AIPipeline {
  constructor(options = {}) {
    this.config = {
      baseUrl: options.baseUrl || config.baseUrl,
      baseVideo: options.baseVideo || config.baseVideoPath,
      outputDir: options.outputDir || config.outputDir,
      baseAudio: options.baseAudio || config.baseAudioPath,
      maxConcurrent: Math.min(options.maxConcurrentProcessing || 4, 20),
      minPriority: 2,
      checkInterval: 1000,
      zonosTtsPort: config.zonosTtsPort,
      zonosTtsEndpoint: config.zonosTtsEndpoint,
      latentSyncPort: config.latentSyncPort,
      latentSyncEndpoint: config.latentsyncEndpoint,
      useElevenLabs: options.useElevenLabs || config.useElevenLabs,
      useFalLatentSync: options.useFalLatentSync || config.useFalLatentSync,
      useZonosTTSLocal: options.useZonosTTSLocal || config.useZonosTTSLocal,
      useZonosTTSAPI: options.useZonosTTSAPI || config.useZonosTTSAPI,
      useCloudyAPI: options.useCloudyAPI || config.useCloudyAPI,

      zonosApiKey: options.zonosApiKey || config.zonosApiKey,
    };

    // Single queue with status tracking
    this.pipeline = new Map(); // messageId -> PipelineItem
  }

  /**
   * Initialize the pipeline
   */
  async initialize() {
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
   * Pipeline Item Status Enum
   */
  static Status = {
    RECEIVED: 'received',
    EVALUATING: 'evaluating',
    REJECTED: 'rejected',
    GENERATING_RESPONSE: 'generating_response',
    GENERATING_SPEECH: 'generating_speech',
    GENERATING_VIDEO: 'generating_video',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  /**
   * Handle new user input
   */
  async handleUserInput(userId, message) {
    const messageId = `${userId}-${Date.now()}`;
    
    // Create pipeline item
    const pipelineItem = {
      messageId,
      userId,
      message,
      status: AIPipeline.Status.RECEIVED,
      timestamp: Date.now(),
      updates: [{
        status: AIPipeline.Status.RECEIVED,
        timestamp: Date.now()
      }]
    };

    this.pipeline.set(messageId, pipelineItem);
    logger.info(`New input received: ${messageId}`);

    // Start processing if capacity available
    if (this.getActiveProcessingCount() < this.config.maxConcurrent) {
      this.processItem(pipelineItem).catch(err => 
        logger.error(`Failed to process item ${messageId}: ${err.message}`)
      );
    }

    return { messageId, status: AIPipeline.Status.RECEIVED };
  }

  /**
   * Update item status with timestamp
   */
  updateStatus(item, status) {
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
  getActiveProcessingCount() {
    return Array.from(this.pipeline.values()).filter(item => 
      item.status !== AIPipeline.Status.RECEIVED &&
      item.status !== AIPipeline.Status.COMPLETED &&
      item.status !== AIPipeline.Status.REJECTED &&
      item.status !== AIPipeline.Status.FAILED
    ).length;
  }

  /**
   * Process a single item through the pipeline
   */
  async processItem(item) {
    try {
      // Evaluate
      this.updateStatus(item, AIPipeline.Status.EVALUATING);
      const evaluation = await this.evaluator.evaluateInputs([item]);
      const evaluated = evaluation[0];

      if (evaluated.priority < this.config.minPriority) {
        this.updateStatus(item, AIPipeline.Status.REJECTED);
        return;
      }

      // Generate response using the service
      this.updateStatus(item, AIPipeline.Status.GENERATING_RESPONSE);
      const response = await this.textGenerator.generateText(item.message);
      item.response = response;
      logger.info(`Generated response: ${response}`);

      // Generate speech
      this.updateStatus(item, AIPipeline.Status.GENERATING_SPEECH);
      const audioPath = await this.tts.convert(response);
      item.audioPath = audioPath;
      logger.info(`Generated speech at: ${audioPath}`);
      // Generate video
      this.updateStatus(item, AIPipeline.Status.GENERATING_VIDEO);
      const videoPath = await this.sync.process(audioPath);
      item.videoPath = videoPath;
      logger.info(`Generated video at: ${videoPath}`);
      

      // Mark as completed
      this.updateStatus(item, AIPipeline.Status.COMPLETED);

      // Clean up files
      fs.unlinkSync(audioPath);
      // fs.unlinkSync(videoPath);
    } catch (error) {
      logger.error(`Pipeline error for ${item.messageId}: ${error.message}`);
      this.updateStatus(item, AIPipeline.Status.FAILED);
      item.error = error.message;
    }

    // Start processing next item if available
    this.processNextItems();
  }

  /**
   * Process next items if capacity available
   */
  processNextItems() {
    const availableSlots = this.config.maxConcurrent - this.getActiveProcessingCount();
    if (availableSlots <= 0) return;

    // Get pending items
    const pending = Array.from(this.pipeline.values())
      .filter(item => item.status === AIPipeline.Status.RECEIVED)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Process up to available slots
    pending.slice(0, availableSlots).forEach(item => {
      this.processItem(item).catch(err => 
        logger.error(`Failed to process item ${item.messageId}: ${err.message}`)
      );
    });
  }

  /**
   * Get all completed videos ready for playback
   */
  getCompletedVideos() {
    return Array.from(this.pipeline.values())
      .filter(item => item.status === AIPipeline.Status.COMPLETED)
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
  markVideoPlayed(messageId) {
    const item = this.pipeline.get(messageId);
    if (item?.status === AIPipeline.Status.COMPLETED) {
      fs.unlinkSync(item.videoPath);
      this.pipeline.delete(messageId);
      return true;
    }
    return false;
  }

  /**
   * Get detailed pipeline status
   */
  getStatus() {
    const items = Array.from(this.pipeline.values());
    const countByStatus = Object.values(AIPipeline.Status).reduce((acc, status) => {
      acc[status] = items.filter(item => item.status === status).length;
      return acc;
    }, {});

    return {
      activeProcessing: this.getActiveProcessingCount(),
      maxConcurrent: this.config.maxConcurrent,
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

    const processCLIInput = async () => {
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
        logger.error(`CLI input error: ${error.message}`);
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
        logger.error(`Failed to initialize pipeline: ${error.message}`);
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
      logger.error(`Failed to initialize pipeline: ${error.message}`);
      process.exit(1);
    }
  })();
}

// Express routes
app.post('/input', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pipeline.handleUserInput(userId, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json(pipeline.getStatus());
});

app.get('/next-video', (req, res) => {
  const videos = pipeline.getCompletedVideos();
  if (videos.length === 0) {
    return res.status(404).json({ error: 'No videos available' });
  }
  res.json(videos[0]);
});

app.post('/stream/:messageId', (req, res) => {
  const success = pipeline.markVideoPlayed(req.params.messageId);
  if (!success) {
    return res.status(404).json({ error: 'Video not found or already played' });
  }
  res.json({ success: true });
});

app.get('/video/:filename', (req, res) => {
  const videoPath = path.join(pipeline.config.outputDir, req.params.filename);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.sendFile(path.resolve(videoPath));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});