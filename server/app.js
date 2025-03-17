// app.js - Main application for Lambda Cloud AI Video Pipeline
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');
const config = require('./config');
const { logger } = require('./utils/logger');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class AIPipeline {
  constructor(options = {}) {
    // Configuration
    this.baseVideo = options.baseVideo || config.baseVideoPath;
    this.outputDir = options.outputDir || config.outputDir;
    this.zonosTTSEndpoint = options.zonosTTSEndpoint || config.zonosTtsEndpoint;
    this.latentSyncEndpoint = options.latentSyncEndpoint || config.latentsyncEndpoint;
    this.minQueueSize = options.minQueueSize || config.minQueueSize;
    this.maxQueueSize = options.maxQueueSize || config.maxQueueSize;
    
    // State management
    this.isProcessing = false;
    this.videoQueue = []; // Processed videos ready to play
    this.generationQueue = []; // Inputs waiting to be processed
    this.currentlyPlaying = null;
    this.lastStreamTime = 0;
    this.userInputs = []; // Store recent user inputs
    
    // Logging
    this.logFile = path.join(this.outputDir, 'pipeline.log');
  }

  /**
   * Log message to file and console
   */
  log(message, type = 'info') {
    logger[type](message);
  }

  /**
   * Initialize the pipeline
   */
  async initialize() {
    this.log('Initializing AI video pipeline');
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    // Verify base video exists
    if (!fs.existsSync(this.baseVideo)) {
      this.log(`Base video not found at ${this.baseVideo}`, 'error');
      throw new Error(`Base video not found at ${this.baseVideo}`);
    }
    
    // Check connections to local services
    try {
      // Test Zonos TTS connection
      const ttsResponse = await fetch(`${this.zonosTTSEndpoint}/health`, { 
        method: 'GET',
        timeout: 5000
      }).catch(e => ({ ok: false }));
      
      if (!ttsResponse.ok) {
        this.log('Warning: Cannot connect to Zonos TTS service', 'warn');
      } else {
        this.log('Successfully connected to Zonos TTS service');
      }
      
      // Test LatentSync connection
      const lsResponse = await fetch(`${this.latentSyncEndpoint}/health`, { 
        method: 'GET',
        timeout: 5000
      }).catch(e => ({ ok: false }));
      
      if (!lsResponse.ok) {
        this.log('Warning: Cannot connect to LatentSync service', 'warn');
      } else {
        this.log('Successfully connected to LatentSync service');
      }
    } catch (error) {
      this.log(`Error checking service connections: ${error.message}`, 'warn');
    }
    
    // Test OpenAI connection
    try {
      // Just a simple models list request to verify connection
      const models = await openai.models.list();
      this.log('Successfully connected to OpenAI API');
    } catch (error) {
      this.log(`Error connecting to OpenAI: ${error.message}`, 'error');
      throw new Error(`Failed to connect to OpenAI: ${error.message}`);
    }
    
    // Start generation queue processor
    this.startGenerationQueueProcessor();
    
    this.log('Pipeline initialized and ready to receive inputs');
    return true;
  }

  /**
   * Handle a new user input from the chat interface
   */
  async handleUserInput(userId, message, timestamp = Date.now()) {
    this.log(`Received input from User ${userId}: "${message}"`);
    
    // Store this input
    this.userInputs.push({
      userId,
      message,
      timestamp,
      processed: false
    });
    
    // Keep only last a reasonable number of messages to avoid memory bloat
    if (this.userInputs.length > 50) {
      this.userInputs = this.userInputs.slice(-50);
    }
    
    // If generation queue is below max capacity, evaluate new inputs
    if (this.generationQueue.length < this.maxQueueSize) {
      await this.evaluateInputs();
    } else {
      this.log('Generation queue at capacity, will evaluate new inputs later');
    }
    
    return {
      status: 'success',
      message: 'Input received and queued for processing',
      queuePosition: this.generationQueue.length
    };
  }

  /**
   * Evaluate and prioritize user inputs using OpenAI
   */
  async evaluateInputs() {
    // Get unprocessed inputs
    const unprocessedInputs = this.userInputs.filter(input => !input.processed);
    
    if (unprocessedInputs.length === 0) {
      return;
    }
    
    this.log(`Evaluating ${unprocessedInputs.length} unprocessed inputs`);
    
    try {
      // Get recent messages for context
      const recentMessages = this.userInputs.slice(-10).map(input => ({
        userId: input.userId,
        message: input.message,
        timestamp: new Date(input.timestamp).toISOString()
      }));
      
      // Format unprocessed inputs
      const inputs = unprocessedInputs.map(input => ({
        userId: input.userId,
        message: input.message,
        timestamp: new Date(input.timestamp).toISOString()
      }));
      
      // Prepare prompt for OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",  // Use the appropriate model
        messages: [
          {
            role: "system",
            content: `You are an AI prioritization system that evaluates chat messages and decides which ones to respond to first.
            
Your task is to evaluate unprocessed messages and prioritize them by assigning a score from 1-10 (10 being highest priority).
Consider factors like urgency, relevance, complexity, and user engagement.
For each message, provide a brief reason why you assigned that priority.

Return a JSON array of objects with these fields:
1. userId: The original user ID
2. message: The original message
3. timestamp: The original timestamp
4. priority: A number from 1-10
5. reason: Brief explanation of priority assignment (1-2 sentences)`
          },
          {
            role: "user",
            content: `Here are the recent messages for context:
${JSON.stringify(recentMessages, null, 2)}

Here are the unprocessed messages that need prioritization:
${JSON.stringify(inputs, null, 2)}

Please evaluate and return prioritized messages in JSON format like {"prioritizedMessages": [...]}`
          }
        ],
        response_format: { type: "json_object" }
      });
      
      // Parse the response
      const content = response.choices[0].message.content;
      const data = JSON.parse(content);
      
      // The OpenAI should return prioritized inputs as an array
      const prioritizedInputs = data.prioritizedMessages || [];
      
      this.log(`OpenAI prioritized ${prioritizedInputs.length} inputs`);
      
      // Add prioritized inputs to generation queue
      for (const input of prioritizedInputs) {
        // Find the original input to mark as processed
        const originalInput = this.userInputs.find(i => 
          i.userId === input.userId && 
          i.message === input.message
        );
        
        if (originalInput) {
          originalInput.processed = true;
        }
        
        // Add to generation queue with priority
        this.generationQueue.push({
          userId: input.userId,
          message: input.message,
          priority: input.priority,
          timestamp: input.timestamp,
          reason: input.reason
        });
      }
      
      // Sort generation queue by priority
      this.generationQueue.sort((a, b) => b.priority - a.priority);
      
      this.log(`Generation queue now has ${this.generationQueue.length} items`);
    } catch (error) {
      this.log(`Error evaluating inputs: ${error.message}`, 'error');
    }
  }

  /**
   * Start the generation queue processor
   */
  startGenerationQueueProcessor() {
    this.log('Starting generation queue processor');
    
    // Check regularly if we need to generate more videos
    const processorInterval = setInterval(async () => {
      // If we're not already processing and there are items in the queue
      if (!this.isProcessing && this.generationQueue.length > 0) {
        await this.processNextInQueue();
      }
      
      // If we have no inputs in the generation queue but need more videos
      if (this.generationQueue.length === 0 && this.videoQueue.length < this.minQueueSize) {
        // Re-evaluate inputs in case we missed some
        await this.evaluateInputs();
      }
    }, 2000); // Check every 2 seconds
    
    // Prevent the interval from keeping the process alive forever
    processorInterval.unref();
  }

  /**
   * Process the next item from the generation queue
   */
  async processNextInQueue() {
    if (this.generationQueue.length === 0) {
      return;
    }
    
    // Get highest priority item from queue
    const nextItem = this.generationQueue.shift();
    
    this.log(`Processing queued item from User ${nextItem.userId}: "${nextItem.message}"`);
    this.log(`Reason for selection: ${nextItem.reason}`);
    
    this.isProcessing = true;
    
    try {
      // Generate text response to this input
      const generatedText = await this.generateText(nextItem.message, nextItem.userId);
      this.log(`Generated text: "${generatedText}"`);

      // Convert text to speech
      const audioPath = await this.textToSpeech(generatedText);
      this.log(`Speech generated at: ${audioPath}`);

      // Create video with LatentSync
      const videoPath = await this.synchronizeVideo(audioPath);
      this.log(`Video generated at: ${videoPath}`);

      // Add to video queue
      this.videoQueue.push({
        path: videoPath,
        userId: nextItem.userId,
        originalMessage: nextItem.message,
        generatedText: generatedText,
        timestamp: Date.now()
      });
      
      this.log(`Video added to play queue. Queue length: ${this.videoQueue.length}`);
    } catch (error) {
      this.log(`Error processing queue item: ${error.message}`, 'error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Generate text using OpenAI
   */
  async generateText(message, userId) {
    this.log(`Generating text response for: "${message}"`);
    
    try {
      // Get recent conversation history for context
      const recentHistory = this.userInputs
        .filter(input => input.userId === userId)
        .slice(-5); // Last 5 messages from this user
      
      const contextMessages = recentHistory.map(input => ({
        role: "user",
        content: input.message
      }));
      
      // Call OpenAI API
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",  // Use the appropriate model for your needs
        messages: [
          {
            role: "system",
            content: `You are a helpful and concise AI assistant for a video generation system. 
Your responses will be converted to speech and synchronized with video.
Keep your responses between 15-30 seconds when spoken (approximately 30-60 words).
Be natural, engaging, and concise.`
          },
          ...contextMessages,
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 150  // Limit token length to keep responses brief
      });
      
      return response.choices[0].message.content.trim();
    } catch (error) {
      this.log(`Text generation error: ${error.message}`, 'error');
      return 'I apologize, but I encountered an issue processing your request. How can I help you today?';
    }
  }

  /**
   * Convert text to speech using Zonos TTS
   */
  async textToSpeech(text) {
    this.log(`Converting to speech: "${text}"`);
    
    try {
      // Call Zonos TTS API
      const response = await fetch(this.zonosTTSEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text,
          voice: "en_female_1",  // Specify voice if needed
          speed: 1.0             // Adjust speed if needed
        })
      });
      
      if (!response.ok) {
        throw new Error(`TTS API error: ${response.statusText}`);
      }
      
      // Get audio data as buffer
      const audioBuffer = await response.buffer();
      
      // Save to file
      const audioFileName = `speech_${Date.now()}.wav`;
      const audioPath = path.join(this.outputDir, audioFileName);
      
      fs.writeFileSync(audioPath, audioBuffer);
      this.log(`Saved audio to ${audioPath}`);
      
      return audioPath;
    } catch (error) {
      this.log(`Speech generation error: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Synchronize audio with video using LatentSync
   */
  async synchronizeVideo(audioPath) {
    this.log(`Synchronizing video with audio from: ${audioPath}`);
    
    try {
      // Create a form with the base video and the generated audio
      const formData = new FormData();
      formData.append('video', fs.createReadStream(this.baseVideo));
      formData.append('audio', fs.createReadStream(audioPath));
      
      // Optional parameters
      formData.append('lip_sync_strength', '0.8');  // Adjust as needed
      formData.append('preserve_identity', 'true');
      
      // Call LatentSync API
      const response = await fetch(this.latentSyncEndpoint, {
        method: 'POST',
        body: formData,
        timeout: 120000  // 2 minute timeout for video processing
      });
      
      if (!response.ok) {
        throw new Error(`LatentSync API error: ${response.statusText}`);
      }
      
      // Get video data as buffer
      const videoBuffer = await response.buffer();
      
      // Save to file
      const videoFileName = `video_${Date.now()}.mp4`;
      const videoPath = path.join(this.outputDir, videoFileName);
      
      fs.writeFileSync(videoPath, videoBuffer);
      this.log(`Saved synchronized video to ${videoPath}`);
      
      return videoPath;
    } catch (error) {
      this.log(`Video synchronization error: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Get system status for monitoring
   */
  getStatus() {
    return {
      videosInPlayQueue: this.videoQueue.length,
      inputsInGenerationQueue: this.generationQueue.length,
      currentlyProcessing: this.isProcessing,
      lastProcessedTimestamp: this.lastStreamTime > 0 ? new Date(this.lastStreamTime).toISOString() : null,
      unprocessedInputs: this.userInputs.filter(i => !i.processed).length,
      generationQueue: this.generationQueue.map(item => ({
        userId: item.userId,
        message: item.message.substring(0, 50) + (item.message.length > 50 ? '...' : ''),
        priority: item.priority
      })),
      videoQueue: this.videoQueue.map(item => ({
        userId: item.userId,
        originalMessage: item.originalMessage.substring(0, 50) + (item.originalMessage.length > 50 ? '...' : ''),
        path: path.basename(item.path),
        timestamp: new Date(item.timestamp).toISOString()
      }))
    };
  }

  /**
   * Get a video by path
   */
  getVideo(videoPath) {
    const fullPath = path.join(this.outputDir, videoPath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    return null;
  }

  /**
   * Get the next video to stream
   */
  getNextVideo() {
    if (this.videoQueue.length === 0) {
      return null;
    }
    
    // Sort by timestamp (oldest first)
    this.videoQueue.sort((a, b) => a.timestamp - b.timestamp);
    
    // Return but don't remove the next video
    return this.videoQueue[0];
  }

  /**
   * Mark a video as streamed (remove from queue)
   */
  markVideoAsStreamed(videoPath) {
    const index = this.videoQueue.findIndex(item => item.path === videoPath);
    if (index !== -1) {
      const video = this.videoQueue.splice(index, 1)[0];
      this.lastStreamTime = Date.now();
      this.log(`Marked video as streamed: ${path.basename(videoPath)}`);
      return video;
    }
    return null;
  }
}

// Create and initialize the pipeline
const pipeline = new AIPipeline();
let initialized = false;

// Initialize on startup
(async () => {
  try {
    await pipeline.initialize();
    initialized = true;
  } catch (error) {
    logger.error('Failed to initialize pipeline:', error);
    process.exit(1);
  }
})();

// API routes
app.post('/input', async (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: 'System initializing, please try again shortly' });
  }

  const { userId, message } = req.body;
  
  if (!userId || !message) {
    return res.status(400).json({ error: 'userId and message are required' });
  }
  
  try {
    const result = await pipeline.handleUserInput(userId, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  if (!initialized) {
    return res.status(503).json({ status: 'initializing' });
  }
  
  res.json(pipeline.getStatus());
});

app.get('/next-video', (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: 'System initializing' });
  }
  
  const nextVideo = pipeline.getNextVideo();
  if (!nextVideo) {
    return res.status(404).json({ error: 'No videos in queue' });
  }
  
  res.json({
    videoPath: path.basename(nextVideo.path),
    userId: nextVideo.userId,
    originalMessage: nextVideo.originalMessage,
    generatedText: nextVideo.generatedText,
    timestamp: nextVideo.timestamp
  });
});

app.post('/stream/:videoPath', (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: 'System initializing' });
  }
  
  const videoPath = path.join(pipeline.outputDir, req.params.videoPath);
  const result = pipeline.markVideoAsStreamed(videoPath);
  
  if (!result) {
    return res.status(404).json({ error: 'Video not found in queue' });
  }
  
  res.json({ success: true, video: path.basename(result.path) });
});

app.get('/video/:filename', (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: 'System initializing' });
  }
  
  const filename = req.params.filename;
  const videoPath = path.join(pipeline.outputDir, filename);
  
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  res.sendFile(videoPath);
});

app.get('/base-video', (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: 'System initializing' });
  }
  
  if (!fs.existsSync(pipeline.baseVideo)) {
    return res.status(404).json({ error: 'Base video not found' });
  }
  
  res.sendFile(pipeline.baseVideo);
});

// Simple health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: initialized ? 'ok' : 'initializing',
    timestamp: new Date(),
    openai: !!openai.apiKey,
    queueSizes: initialized ? {
      video: pipeline.videoQueue.length,
      generation: pipeline.generationQueue.length
    } : null
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

module.exports = { app, pipeline };