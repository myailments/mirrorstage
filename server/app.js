// app.js - Main application for Lambda Cloud AI Video Pipeline
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import config from './config.js';
import { logger } from './utils/logger.js';
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { fal } from "@fal-ai/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    this.baseUrl = options.baseUrl || config.baseUrl;
    this.baseVideo = options.baseVideo || config.baseVideoPath;
    this.outputDir = options.outputDir || config.outputDir;
    this.zonosTTSEndpoint = options.zonosTTSEndpoint || config.zonosTtsEndpoint;
    this.latentSyncEndpoint = options.latentSyncEndpoint || config.latentsyncEndpoint;
    this.latentSyncPort = options.latentSyncPort || config.latentSyncPort;
    this.minQueueSize = Math.max(1, options.minQueueSize || config.minQueueSize || 2);
    this.maxQueueSize = Math.max(this.minQueueSize, options.maxQueueSize || config.maxQueueSize || 20);
    this.maxConcurrentProcessing = Math.min(
      options.maxConcurrentProcessing || 4,
      this.maxQueueSize
    );

    // State management
    this.isProcessing = false;
    this.videoQueue = []; // Processed videos ready to play
    this.generationQueue = []; // Inputs waiting to be processed
    this.currentlyPlaying = null;
    this.lastStreamTime = 0;
    this.userInputs = []; // Store recent user inputs

    // Logging
    this.logFile = path.join(this.outputDir, 'pipeline.log');

    // Enhanced queue state management
    this.processingItems = new Map(); // Track processing items with their start times
    this.activeProcessingCount = 0;

    // More lenient threshold for livestreaming
    this.minPriorityThreshold = options.minPriorityThreshold || 2;

    // Shorter processing timeout for livestreaming
    this.processingTimeout = options.processingTimeout || 120000; // 2 minutes

    // More frequent queue checks
    this.queueCheckInterval = options.queueCheckInterval || 3000; // 3 seconds

    // Add a Set to track processed message IDs
    this.processedMessageIds = new Set();

    // Add ElevenLabs configuration
    this.useElevenLabs = options.useElevenLabs || config.useElevenLabs || false;
    this.elevenLabsApiKey = options.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
    this.elevenLabsVoiceId = options.elevenLabsVoiceId || config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM'; // default voice ID

    // Add FAL.ai configuration
    this.useFalLatentSync = options.useFalLatentSync || config.useFalLatentSync || false;
    this.falApiKey = options.falApiKey || process.env.FAL_KEY;
    
    // Configure FAL client if using it
    if (this.useFalLatentSync) {
      fal.config({
        credentials: this.falApiKey
      });
    }
  }

  /**
   * Log message to file and console
   */
  log(message, type = 'info') {
    // Ensure type is a string and normalize it
    const logType = String(type).toLowerCase();

    switch (logType) {
      case 'error':
        logger.error(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'info':
      default:
        logger.info(message);
        break;
    }
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


    // Verify if assets directory exists
    const assetsDir = path.join(__dirname, '../assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }


    // Verify base video exists
    if (!fs.existsSync(this.baseVideo)) {
      this.log(`Base video not found at ${this.baseVideo}`, 'error');
      throw new Error(`Base video not found at ${this.baseVideo}`);
    }

    // Check connections to local services
    try {
      // Test Zonos TTS connection
      const ttsResponse = await fetch(`${this.baseUrl}:${this.zonosTtsPort}/health`, {
        method: 'GET',
        timeout: 5000
      }).catch(e => ({ ok: false }));

      if (!ttsResponse.ok) {
        this.log('Warning: Cannot connect to Zonos TTS service', 'warn');
      } else {
        this.log('Successfully connected to Zonos TTS service');
      }

      // Test LatentSync connection
      const lsResponse = await fetch(`${this.baseUrl}:${this.latentSyncPort}/health`, {
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
    // Generate a unique message ID
    const messageId = `${userId}-${timestamp}`;
    
    // Check if this message has already been processed
    if (this.processedMessageIds.has(messageId)) {
      this.log(`Skipping duplicate message ${messageId}`, 'warn');
      return {
        status: 'skipped',
        message: 'Message already processed',
        queuePosition: this.generationQueue.length
      };
    }

    this.log(`Received input from User ${userId}: "${message}"`);
    
    // Store this input with messageId
    this.userInputs.push({
      messageId,
      userId,
      message,
      timestamp,
      processed: false
    });
    
    // Add to processed set
    this.processedMessageIds.add(messageId);

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
    // Only get unprocessed inputs that haven't been evaluated
    const unprocessedInputs = this.userInputs.filter(input => 
      !input.processed && 
      !this.generationQueue.some(item => item.messageId === input.messageId)
    );

    if (unprocessedInputs.length === 0) return;

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

      // More lenient livestreamer-focused prompt

      const EvaluatedMessage = z.object({
        userId: z.string(),
        message: z.string(),
        timestamp: z.string(),
        priority: z.number(),
        reason: z.string()
      });

      const EvaluatedMessages = z.object({
        evaluatedMessages: z.array(EvaluatedMessage)
      });
      
      const completion = await openai.beta.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages: [
          {
            role: "system",
            content: `You are a priority system for a livestreaming AI that interacts with chat.
            
      Evaluate chat messages and assign priority scores from 0-10 where:
- 0-1: Only for obvious spam or completely nonsensical messages
- 2-10: Most messages should fall in this range, with higher scores for:
  * Questions or comments that would be entertaining to respond to
  * Messages that could lead to engaging interactions
  * Funny or creative messages
  * Messages that multiple users might enjoy hearing a response to
  * Messages that could showcase the AI's personality

The goal is to be engaging and entertaining, like a livestreamer interacting with chat.
Most normal messages should get at least a 3-4 score to ensure good chat interaction.
Be generous with scoring - it's better to respond to more messages than fewer.

Return a JSON array with fields:
1. userId: Original user ID
2. message: Original message
3. timestamp: Original timestamp
4. priority: Number 0-10
5. reason: Brief explanation of priority (focus on entertainment value)`
          },
          {
            role: "user",
            content: `Recent chat messages:
${JSON.stringify(recentMessages, null, 2)}

New messages to evaluate:
${JSON.stringify(inputs, null, 2)}`
          }
        ],
        response_format: zodResponseFormat(EvaluatedMessages, 'evaluatedMessages')
      });
      
      

      const content = completion.choices[0]?.message?.parsed;
      if (!content) {
        this.log(`Error: No content received from OpenAI: ${JSON.stringify(response, null, 2)}`, 'error');
        return;
      }


      const data = content.evaluatedMessages;
      this.log('OpenAI Response:', data); // Debug log to see structure

      // Get the messages array from the response
      const prioritizedInputs = data || [];

      // Mark all evaluated inputs as processed
      unprocessedInputs.forEach(input => {
        input.processed = true;
      });

      // Lower the threshold for what's considered worth responding to
      this.minPriorityThreshold = 2; // Much more lenient threshold

      // Filter and add items to generation queue
      const respondableInputs = Array.isArray(prioritizedInputs)
        ? prioritizedInputs.filter(input => input.priority >= this.minPriorityThreshold)
        : [];

      this.log(`Found ${respondableInputs.length} messages to respond to`);

      // When adding to generation queue, include messageId
      for (const input of respondableInputs) {
        // Find the original input to get its messageId
        const originalInput = unprocessedInputs.find(
          orig => orig.userId === input.userId && 
          orig.message === input.message
        );
        
        if (originalInput) {
          this.log(`Adding message to generation queue: ${originalInput.messageId}`);
          this.generationQueue.push({
            messageId: originalInput.messageId,
            userId: input.userId,
            message: input.message,
            priority: input.priority,
            timestamp: input.timestamp,
            reason: input.reason
          });
        }
      }

      // Sort queue by priority but add some randomness for variety
      this.generationQueue.sort((a, b) => {
        // Add small random factor (-0.5 to 0.5) to priority for more dynamic ordering
        const randomFactorA = Math.random() - 0.5;
        const randomFactorB = Math.random() - 0.5;
        return (b.priority + randomFactorB) - (a.priority + randomFactorA);
      });

      // Log distribution with new categories
      this.logPriorityDistribution(prioritizedInputs);

    } catch (error) {
      this.log(`Error evaluating inputs: ${error.message}`, 'error');
      unprocessedInputs.forEach(input => {
        input.processed = false;
      });
    }
  }

  /**
   * Start parallel processing of high-priority items
   */
  startGenerationQueueProcessor() {
    this.log('Starting parallel generation queue processor');
    
    const processorInterval = setInterval(async () => {
      try {
        // Clean up old processed messages periodically
        this.cleanupProcessedMessages();
        
        // First, evaluate any pending inputs
        if (this.userInputs.some(input => !input.processed)) {
          await this.evaluateInputs();
        }

        // Process multiple items in parallel up to maxConcurrentProcessing
        while (
          this.activeProcessingCount < this.maxConcurrentProcessing &&
          this.generationQueue.length > 0
        ) {
          const nextItem = this.generationQueue[0];
          
          // Skip if already being processed
          if (this.processingItems.has(nextItem.messageId)) {
            this.generationQueue.shift();
            continue;
          }

          if (nextItem.priority >= this.minPriorityThreshold) {
            this.processNextInQueue(); // Remove await - let it process asynchronously
          } else {
            // Remove low-priority item from queue
            this.generationQueue.shift();
          }
        }

        // Log queue status less frequently
        if (this.generationQueue.length > 0 || this.activeProcessingCount > 0) {
          // this.logQueueStatus();
        }
      } catch (error) {
        this.log(`Error in queue processor: ${error.message}`, 'error');
      }
    }, 1000);

    processorInterval.unref();
  }

  /**
   * Log priority distribution with new categories
   */
  logPriorityDistribution(prioritizedInputs) {
    const distribution = {
      spam: 0,    // 0-1
      normal: 0,  // 2-5
      good: 0,    // 6-8
      great: 0    // 9-10
    };

    prioritizedInputs.forEach(input => {
      if (input.priority <= 1) distribution.spam++;
      else if (input.priority <= 5) distribution.normal++;
      else if (input.priority <= 8) distribution.good++;
      else distribution.great++;
    });

    this.log(`Chat Message Distribution:
      Spam/Ignored (0-1): ${distribution.spam}
      Normal Chat (2-5): ${distribution.normal}
      Good Messages (6-8): ${distribution.good}
      Great Messages (9-10): ${distribution.great}
    `);
  }

  /**
   * Process the next item from the generation queue
   */
  async processNextInQueue() {
    if (this.generationQueue.length === 0) return;

    const nextItem = this.generationQueue.shift();
    nextItem.retryCount = nextItem.retryCount || 0;

    // Check if this message is already being processed
    if (this.processingItems.has(nextItem.messageId)) {
        this.log(`Skipping duplicate processing of message ${nextItem.messageId}`, 'warn');
        return;
    }

    // Track processing start time and message ID
    this.processingItems.set(nextItem.messageId, {
        item: nextItem,
        startTime: Date.now(),
        status: 'processing'
    });
    this.activeProcessingCount++;

    this.log(`Starting processing for user ${nextItem.userId} (attempt ${nextItem.retryCount + 1})`);

    // Process asynchronously without waiting
    this.processItem(nextItem).catch(error => {
        this.log(`Unhandled error in processItem: ${error.message}`, 'error');
    });
  }

  // Separate the processItem function for better async handling
  async processItem(nextItem) {
    try {
        // First generate the text
        const generatedText = await this.generateText(nextItem.message, nextItem.userId);
        
        // Then convert to speech
        const audioPath = await this.textToSpeech(generatedText);

        // Start video sync but don't await it immediately
        const videoPromise = this.synchronizeVideo(audioPath);
        
        // Update processing status
        const processingInfo = this.processingItems.get(nextItem.messageId);
        if (processingInfo) {
            processingInfo.videoPromise = videoPromise;
            processingInfo.audioPath = audioPath;
            processingInfo.generatedText = generatedText;
        }

        // Now await the video processing
        const videoPath = await videoPromise;

        this.videoQueue.push({
            path: videoPath,
            userId: nextItem.userId,
            messageId: nextItem.messageId,
            originalMessage: nextItem.message,
            generatedText: generatedText,
            timestamp: Date.now(),
            processingTime: Date.now() - this.processingItems.get(nextItem.messageId).startTime
        });

        // Cleanup
        try {
            fs.unlinkSync(audioPath);
        } catch (error) {
            this.log(`Warning: Could not delete temporary audio file: ${error.message}`, 'warn');
        }

        this.log(`Completed processing for user ${nextItem.userId}`);
    } catch (error) {
        this.log(`Error processing item: ${error.message}`, 'error');
        if (nextItem.retryCount < 3) {
            this.generationQueue.unshift({
                ...nextItem,
                retryCount: nextItem.retryCount + 1
            });
        }
    } finally {
        this.processingItems.delete(nextItem.messageId);
        this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);
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
   * Convert text to speech using either Zonos TTS or ElevenLabs
   */
  async textToSpeech(text) {
    this.log(`Converting to speech: "${text}" using ${this.useElevenLabs ? 'ElevenLabs' : 'Zonos TTS'}`);

    if (this.useElevenLabs) {
      return this.elevenLabsTextToSpeech(text);
    } else {
      return this.zonosTextToSpeech(text);
    }
  }

  /**
   * Convert text to speech using ElevenLabs
   */
  async elevenLabsTextToSpeech(text) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.elevenLabsApiKey
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true
          }
        })
      });

      this.log(`ElevenLabs Response status: ${response.status}`);
      this.log(`ElevenLabs Response headers: ${JSON.stringify(response.headers.raw())}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`ElevenLabs Error response: ${errorText}`);
        throw new Error(`ElevenLabs API error: ${response.statusText}`);
      }

      // Get audio data as buffer
      this.log('Attempting to get response buffer...');
      const audioBuffer = await response.arrayBuffer();
      this.log(`Received array buffer of size: ${audioBuffer.byteLength} bytes`);

      // Convert ArrayBuffer to Buffer
      this.log('Converting ArrayBuffer to Node Buffer...');
      const nodeBuffer = Buffer.from(audioBuffer);
      this.log(`Converted to Node Buffer of size: ${nodeBuffer.length} bytes`);

      // Save to file
      const audioFileName = `speech_${Date.now()}.mp3`; // Note: ElevenLabs returns MP3
      const audioPath = path.join(this.outputDir, audioFileName);

      this.log(`Writing buffer to file: ${audioPath}`);
      fs.writeFileSync(audioPath, nodeBuffer);

      // Verify the saved file
      const stats = fs.statSync(audioPath);
      this.log(`Saved audio file size: ${stats.size} bytes`);

      if (stats.size === 0) {
        throw new Error('Saved audio file is empty');
      }

      return audioPath;
    } catch (error) {
      this.log(`ElevenLabs TTS error: ${error.stack}`, 'error');
      throw error;
    }
  }

  /**
   * Convert text to speech using Zonos TTS (renamed original method)
   */
  async zonosTextToSpeech(text) {
    this.log(`Converting to speech: "${text}"`);

    try {
      // Call Zonos TTS API
      const ttsEndpoint = `${this.baseUrl}:${this.zonosTtsPort}${this.zonosTTSEndpoint}`;
      this.log(`Calling TTS API at: ${ttsEndpoint}`);
      
      const response = await fetch(ttsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: "en_female_1",
          speed: 1.0
        })
      });

      this.log(`Response status: ${response.status}`);
      this.log(`Response headers: ${JSON.stringify(response.headers.raw())}`);
      const contentLength = response.headers.get('content-length');
      this.log(`Audio data size: ${contentLength} bytes`);

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`TTS Error response: ${errorText}`);
        throw new Error(`TTS API error: ${response.statusText}`);
      }

      try {
        // Get audio data as buffer
        this.log('Attempting to get response buffer...');
        const audioBuffer = await response.arrayBuffer();
        this.log(`Received array buffer of size: ${audioBuffer.byteLength} bytes`);
        
        // Convert ArrayBuffer to Buffer
        this.log('Converting ArrayBuffer to Node Buffer...');
        const nodeBuffer = Buffer.from(audioBuffer);
        this.log(`Converted to Node Buffer of size: ${nodeBuffer.length} bytes`);

        // Save to file
        const audioFileName = `speech_${Date.now()}.wav`;
        const audioPath = path.join(this.outputDir, audioFileName);

        this.log(`Writing buffer to file: ${audioPath}`);
        fs.writeFileSync(audioPath, nodeBuffer);
        
        // Verify the saved file
        const stats = fs.statSync(audioPath);
        this.log(`Saved audio file size: ${stats.size} bytes`);

        if (stats.size === 0) {
          throw new Error('Saved audio file is empty');
        }

        return audioPath;
      } catch (bufferError) {
        this.log(`Error processing audio buffer: ${bufferError.stack}`, 'error');
        throw bufferError;
      }
    } catch (error) {
      this.log(`Speech generation error: ${error.stack}`, 'error');
      throw error;
    }
  }

  /**
   * Synchronize audio with video using either local LatentSync or FAL.ai
   */
  async synchronizeVideo(audioPath) {
    if (this.useFalLatentSync) {
      return this.falLatentSync(audioPath);
    } else {
      return this.localLatentSync(audioPath);
    }
  }

  /**
   * Synchronize using FAL.ai's LatentSync
   */
  async falLatentSync(audioPath) {
    this.log(`Synchronizing video with FAL.ai LatentSync using audio from: ${audioPath}`);

    try {
      // First, upload the audio and video files to FAL storage
      this.log('Uploading files to FAL storage...');
      
      const audioFile = fs.readFileSync(audioPath);
      const videoFile = fs.readFileSync(this.baseVideo);
      
      // Upload files in parallel
      const [audioUrl, videoUrl] = await Promise.all([
        fal.storage.upload(new Blob([audioFile], { type: 'audio/wav' })),
        fal.storage.upload(new Blob([videoFile], { type: 'video/mp4' }))
      ]);

      this.log('Files uploaded, calling LatentSync...');

      // Start the FAL.ai process but don't await it immediately
      const falPromise = fal.subscribe("fal-ai/latentsync", {
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          guidance_scale: 1,
          loop_mode: "loop"
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            update.logs.map((log) => log.message).forEach(msg => 
              this.log(`FAL.ai progress: ${msg}`)
            );
          }
        },
      });

      // Allow other processing to continue while this runs
      const result = await falPromise;

      if (!result.data || !result.data.video || !result.data.video.url) {
        throw new Error('No video URL in FAL.ai response');
      }

      // Download the resulting video
      this.log('Downloading synchronized video...');
      const videoResponse = await fetch(result.data.video.url);
      const videoBuffer = await videoResponse.arrayBuffer();

      // Save to file
      const videoFileName = `video_${Date.now()}.mp4`;
      const videoPath = path.join(this.outputDir, videoFileName);

      fs.writeFileSync(videoPath, Buffer.from(videoBuffer));
      this.log(`Saved synchronized video to ${videoPath}`);

      return videoPath;
    } catch (error) {
      this.log(`FAL.ai LatentSync error: ${error.stack}`, 'error');
      throw error;
    }
  }

  /**
   * Synchronize using local LatentSync (renamed original method)
   */
  async localLatentSync(audioPath) {
    this.log(`Synchronizing video with audio from: ${audioPath}`);

    try {
      // Create a form with the base video and the generated audio
      const formData = new FormData();
      formData.append('video', fs.createReadStream(this.baseVideo));
      formData.append('audio', fs.createReadStream(audioPath));

      const latentSyncEndpoint = `${this.baseUrl}:${this.latentSyncPort}${this.latentSyncEndpoint}`;


      // Call LatentSync API
      const response = await fetch(latentSyncEndpoint, {
        method: 'POST',
        body: formData,
        timeout: 120000  // 2 minute timeout for video processing
      });

      if (!response.ok) {
        throw new Error(`LatentSync API error: ${response.statusText}`);
      }

      // Get video data as buffer
      const videoBuffer = await response.arrayBuffer();

      // Save to file
      const videoFileName = `video_${Date.now()}.mp4`;
      const videoPath = path.join(this.outputDir, videoFileName);

      fs.writeFileSync(videoPath, Buffer.from(videoBuffer));
      this.log(`Saved synchronized video to ${videoPath}`);

      return videoPath;
    } catch (error) {
      this.log(`Video synchronization error: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Log current queue status
   */
  logQueueStatus() {
    this.log(`Queue Status:
      Videos Ready: ${this.videoQueue.length}
      Waiting in Queue: ${this.generationQueue.length}
      Currently Processing: ${this.activeProcessingCount}
      Processing Items: ${this.processingItems.size}
      Max Concurrent: ${this.maxConcurrentProcessing}
    `);
  }

  /**
   * Get enhanced system status
   */
  getStatus() {
    return {
      videosInPlayQueue: this.videoQueue.length,
      inputsInGenerationQueue: this.generationQueue.length,
      currentlyProcessing: this.activeProcessingCount,
      activeProcessingCount: this.activeProcessingCount,
      maxConcurrentProcessing: this.maxConcurrentProcessing,
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
      })),
      queueMetrics: {
        videosReady: this.videoQueue.length,
        waitingInQueue: this.generationQueue.length,
        currentlyProcessing: this.activeProcessingCount,
        maxConcurrent: this.maxConcurrentProcessing,
        minPriorityThreshold: this.minPriorityThreshold
      },
      priorityDistribution: this.generationQueue.reduce((acc, item) => {
        if (item.priority <= 2) acc.ignored++;
        else if (item.priority <= 5) acc.normal++;
        else if (item.priority <= 8) acc.high++;
        else acc.urgent++;
        return acc;
      }, { ignored: 0, normal: 0, high: 0, urgent: 0 }),
      processingDetails: Array.from(this.processingItems.entries()).map(([messageId, info]) => ({
        messageId,
        startTime: new Date(info.startTime).toISOString(),
        elapsedTime: Date.now() - info.startTime,
        status: info.status,
        hasPendingVideo: !!info.videoPromise
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

  // Add a cleanup method to prevent memory leaks
  cleanupProcessedMessages() {
    // Keep only last 1000 processed message IDs
    if (this.processedMessageIds.size > 1000) {
      const idsArray = Array.from(this.processedMessageIds);
      const idsToKeep = idsArray.slice(-1000);
      this.processedMessageIds = new Set(idsToKeep);
    }
    
    // Remove old user inputs
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.userInputs = this.userInputs.filter(input => input.timestamp > oneHourAgo);
  }
}

// Create and initialize the pipeline
const pipeline = new AIPipeline({
  useElevenLabs: config.useElevenLabs,
  useFalLatentSync: config.useFalLatentSync,
});
let initialized = false;

// Initialize on startup
(async () => {
  try {
    await pipeline.initialize();
    initialized = true;
  } catch (error) {
    logger.error(`Failed to initialize pipeline: ${error}`);
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

  res.sendFile(path.resolve(videoPath));
});

app.get('/base-video', (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: 'System initializing' });
  }

  if (!fs.existsSync(pipeline.baseVideo)) {
    return res.status(404).json({ error: 'Base video not found' });
  }

  res.sendFile(path.resolve(pipeline.baseVideo));
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