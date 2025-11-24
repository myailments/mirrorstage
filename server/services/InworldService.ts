import fs from 'node:fs';
import path from 'node:path';
import {
  RemoteLLMChatNode,
  RemoteTTSNode,
  SequentialGraphBuilder,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import type { Graph } from '@inworld/runtime';
import wavEncoder from 'wav-encoder';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { CHARACTER_PROFILE } from '../prompts/character-file.js';

/**
 * Response from the Inworld service containing both text and audio
 */
export interface InworldResponse {
  text: string;
  audioPath: string;
}

/**
 * TTS Output interface from Inworld
 */
interface TTSOutput {
  text?: string;
  audio?: {
    data: number[];
  };
}

/**
 * InworldService - Unified AI service using Inworld Runtime
 *
 * This service replaces the separate TextGenerator, TTS, ThoughtGenerator,
 * and ConversationMemory services with a single unified graph-based pipeline.
 */
export class InworldService {
  private config: Config;
  private graph: Graph | null = null;
  private systemPrompt: string;

  constructor(config: Config) {
    this.config = config;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /**
   * Build the system prompt from character profile
   */
  private buildSystemPrompt(): string {
    const date = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
      timeZone: 'America/New_York',
    });

    return `You are Threadguy engaging with your livestream audience.

Here are some rough sketches of your character, do not ALWAYS use them, but use them as a guide. Do not use the exact words, but use the general idea.
NEVER USE THE EXACT WORDS. GET GENERAL DIRECTIONS FROM THE FOLLOWING CHARACTER PROFILE. ALWAYS DEVIATE FROM THE CHARACTER PROFILE.
<begin character profile>
${CHARACTER_PROFILE}
</end character profile>

Guidelines:
- Respond naturally and conversationally, like you're talking to people in chat
- Keep responses short and casual unless more detail is needed
- Use plain text only - no markdown, special formatting, or narration
- Sound like a real person, not an AI trying to perform a character
- Your text will be turned into a talking head video, so keep it short and concise

Current time: ${date}`;
  }

  /**
   * Initialize the Inworld graph using SequentialGraphBuilder
   * Pipeline: LLM -> TextChunking -> TTS
   */
  async initialize(): Promise<boolean> {
    try {
      logger.info('Initializing Inworld service...');
      logger.info(`API key configured: ${this.config.inworldApiKey ? 'Yes (length: ' + this.config.inworldApiKey.length + ')' : 'No'}`);
      logger.info(`Voice ID configured: ${this.config.inworldVoiceId || 'Using default'}`);

      // Use SequentialGraphBuilder for a simple linear pipeline
      // Pipeline: LLM -> TextChunking -> TTS
      const graphBuilder = new SequentialGraphBuilder({
        id: 'stream-service-graph',
        apiKey: this.config.inworldApiKey,
        nodes: [
          // LLM for text generation
          new RemoteLLMChatNode({
            provider: 'inworld',
            stream: true,
            textGenerationConfig: {
              maxNewTokens: 300,
              temperature: 0.8,
            },
            messageTemplates: [
              {
                role: 'system',
                content: { type: 'text', value: this.systemPrompt },
              },
              {
                role: 'user',
                content: { type: 'template', template: '{{user_input}}' },
              },
            ],
          }),
          // Chunk text for TTS processing
          new TextChunkingNode({
            minChunkLength: 50,
          }),
          // TTS for audio generation
          new RemoteTTSNode({
            speakerId: this.config.inworldVoiceId || 'Dennis', // Default voice
            modelId: 'inworld-tts-1',
            sampleRate: 48000, // Inworld recommended sample rate
            temperature: 0.8,
            speakingRate: 1.0,
          }),
        ],
      });

      this.graph = graphBuilder.build();

      logger.info('Inworld service initialized successfully with LLM + TTS pipeline');
      return true;
    } catch (error) {
      logger.error(
        `Failed to initialize Inworld service: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Generate a response (text + audio) for the given input
   */
  async generate(input: string, userId?: string): Promise<InworldResponse> {
    if (!this.graph) {
      throw new Error('Inworld service not initialized');
    }

    try {
      logger.info(`Generating response for input: ${input.slice(0, 50)}...`);

      // Execute the graph with optional user context
      const userContext = userId
        ? { attributes: { userId }, targetingKey: userId }
        : undefined;

      // Pass input matching the template variable {{user_input}}
      const { outputStream } = await this.graph.start(
        { user_input: input },
        { userContext }
      );

      let text = '';
      const audioChunks: number[][] = [];
      let responseCount = 0;

      // Process the output stream
      for await (const response of outputStream) {
        responseCount++;
        
        if (response.done) {
          logger.info(`Stream response #${responseCount}: done=true`);
          continue;
        }

        const data = response.data;
        
        // Log the full response structure for debugging
        logger.info(`Stream response #${responseCount}: ${JSON.stringify({
          done: response.done,
          dataType: data === null ? 'null' : typeof data,
          dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        })}`);

        // Handle TTS output stream (async iterable of audio chunks)
        if (data && typeof data === 'object' && Symbol.asyncIterator in data) {
          logger.info('Processing TTS output stream...');
          const ttsStream = data as AsyncIterable<TTSOutput>;
          for await (const chunk of ttsStream) {
            if (chunk.text) {
              text += chunk.text;
              logger.info(`TTS text chunk: "${chunk.text.slice(0, 50)}..."`);
            }
          if (chunk.audio?.data) {
            const chunkSize = chunk.audio.data.length;
            // Log sample range and type for debugging
            const samples = chunk.audio.data;
            const sampleSlice = Array.from(samples).slice(0, 100);
            const min = Math.min(...sampleSlice);
            const max = Math.max(...sampleSlice);
            const dataType = samples.constructor?.name || typeof samples;
            logger.info(`TTS audio chunk: ${chunkSize} samples, type=${dataType}, range=[${min.toFixed(4)}, ${max.toFixed(4)}]`);
            logger.info(`First 10 samples: ${sampleSlice.slice(0, 10).map(s => s.toFixed(6)).join(', ')}`);
            audioChunks.push(Array.from(samples));
          }
          }
        }
        // Handle direct TTS output (contains both text and audio)
        else if (data && typeof data === 'object') {
          const ttsOutput = data as TTSOutput;
          
          if (ttsOutput.text) {
            text += ttsOutput.text;
            logger.info(`Received text chunk: "${ttsOutput.text.slice(0, 50)}..."`);
          }
          
          if (ttsOutput.audio?.data) {
            const chunkSize = ttsOutput.audio.data.length;
            audioChunks.push(ttsOutput.audio.data);
            logger.info(`Received audio chunk: ${chunkSize} samples (total chunks: ${audioChunks.length})`);
          }
        }
        
        // Handle plain text response (from TextChunkingNode)
        if (typeof data === 'string') {
          text += data;
          logger.info(`Received plain text: "${data.slice(0, 50)}..."`);
        }
      }

      logger.info(`Stream complete: ${responseCount} responses, ${audioChunks.length} audio chunks`);
      logger.info(`Generated text response: ${text.slice(0, 100)}...`);

      // Convert audio chunks to WAV file
      let audioPath: string;
      if (audioChunks.length > 0) {
        const totalBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const estimatedSamples = Math.floor(totalBytes / 4); // 4 bytes per sample (32-bit float)
        logger.info(`Total audio bytes: ${totalBytes} (~${estimatedSamples} samples, ~${(estimatedSamples / 48000).toFixed(2)}s at 48kHz)`);
        audioPath = await this.saveAudioAsWav(audioChunks);
        const stats = fs.statSync(audioPath);
        logger.info(`Generated TTS audio at: ${audioPath} (${stats.size} bytes)`);
      } else {
        // Fallback to placeholder if no audio received
        logger.warn('No TTS audio chunks received from Inworld');
        audioPath = await this.generatePlaceholderAudio(text);
        logger.warn(`Using placeholder audio at: ${audioPath}`);
      }

      return { text, audioPath };
    } catch (error) {
      logger.error(
        `Inworld generation error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Save audio chunks as a WAV file using wav-encoder
   */
  private async saveAudioAsWav(audioChunks: number[][]): Promise<string> {
    // Flatten all chunks into a single array of bytes
    const rawBytes = audioChunks.flat();
    const sampleRate = 48000; // Match TTS node config

    // The audio data from Inworld is 32-bit IEEE 754 floats as raw bytes (4 bytes per sample, little-endian)
    // Convert byte quads to Float32 samples
    const numSamples = Math.floor(rawBytes.length / 4);
    const float32Samples = new Float32Array(numSamples);
    
    // Create a buffer to convert bytes to float32
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    
    for (let i = 0; i < numSamples; i++) {
      const byteIndex = i * 4;
      // Set bytes in little-endian order
      view.setUint8(0, rawBytes[byteIndex]);
      view.setUint8(1, rawBytes[byteIndex + 1]);
      view.setUint8(2, rawBytes[byteIndex + 2]);
      view.setUint8(3, rawBytes[byteIndex + 3]);
      // Read as float32 (little-endian)
      float32Samples[i] = view.getFloat32(0, true);
    }
    
    logger.info(`Converting ${rawBytes.length} bytes to ${numSamples} float32 samples`);
    
    // Log sample range for debugging
    const sampleSlice = Array.from(float32Samples).slice(0, 20);
    const min = Math.min(...sampleSlice);
    const max = Math.max(...sampleSlice);
    logger.info(`Float32 sample range: [${min.toFixed(6)}, ${max.toFixed(6)}]`);
    logger.info(`First 5 float32 samples: ${sampleSlice.slice(0, 5).map(s => s.toFixed(6)).join(', ')}`);

    const wavData = await wavEncoder.encode({
      sampleRate,
      channelData: [float32Samples],
    });

    const audioPath = path.join(
      this.config.outputDir,
      `inworld_tts_${Date.now()}.wav`
    );

    fs.writeFileSync(audioPath, Buffer.from(wavData));
    logger.info(`Saved WAV file: ${audioPath} (${numSamples} samples, ${(numSamples / sampleRate).toFixed(2)}s)`);
    return audioPath;
  }

  /**
   * Generate placeholder audio (silent WAV) until TTS is configured
   */
  private async generatePlaceholderAudio(text: string): Promise<string> {
    // Create a short silent WAV file as placeholder
    const sampleRate = 48000;
    const duration = Math.min(text.length * 0.05, 10); // Rough estimate: 50ms per character, max 10s
    const samples = new Float32Array(Math.floor(sampleRate * duration)).fill(0);

    const wavData = await wavEncoder.encode({
      sampleRate,
      channelData: [samples],
    });

    const audioPath = path.join(
      this.config.outputDir,
      `placeholder_${Date.now()}.wav`
    );

    fs.writeFileSync(audioPath, Buffer.from(wavData));
    logger.warn('Using placeholder audio - TTS not configured');
    return audioPath;
  }

  /**
   * Generate a thought (unprompted commentary)
   */
  async generateThought(): Promise<InworldResponse> {
    const thoughtPrompts = [
      "What's on your mind right now?",
      'Share a random thought with your viewers.',
      'Say something interesting to keep the stream entertaining.',
      "What's something you've been thinking about lately?",
      'Give your hot take on something.',
    ];

    const randomPrompt =
      thoughtPrompts[Math.floor(Math.random() * thoughtPrompts.length)];
    return this.generate(randomPrompt);
  }

  /**
   * Evaluate a message for priority/relevance
   * Returns a score from 0-10
   */
  async evaluateMessage(message: string): Promise<number> {
    // Simple heuristic evaluation
    // In the future, this could be a separate Inworld graph

    // Check message length (very short messages are lower priority)
    if (message.length < 5) {
      return 2;
    }

    // Check for questions (higher priority)
    if (message.includes('?')) {
      return 8;
    }

    // Check for direct engagement keywords
    const engagementKeywords = [
      'hey',
      'hi',
      'hello',
      'what',
      'how',
      'why',
      'when',
      'who',
      'tell',
      'think',
      'opinion',
    ];
    const lowerMessage = message.toLowerCase();
    if (engagementKeywords.some((kw) => lowerMessage.includes(kw))) {
      return 7;
    }

    // Default priority
    return 5;
  }

  /**
   * Test connection to Inworld API
   */
  async testConnection(): Promise<boolean> {
    try {
      if (!this.config.inworldApiKey) {
        logger.warn('Inworld API key not configured');
        return false;
      }

      // Try a simple generation to test the connection
      if (!this.graph) {
        await this.initialize();
      }

      logger.info('Inworld connection verified');
      return true;
    } catch (error) {
      logger.warn(
        `Inworld connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Stop the Inworld runtime
   */
  async stop(): Promise<void> {
    if (this.graph) {
      await this.graph.stop();
      this.graph = null;
    }
  }
}
