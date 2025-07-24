import fs from 'node:fs';
import path from 'node:path';
import { ZyphraClient as Zyphra } from '@zyphra/client';
import fetch from 'node-fetch';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import type { TTSService } from './interfaces.js';

// Base TTS class
abstract class BaseTTS implements TTSService {
  protected config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  abstract convert(text: string, previousText?: string): Promise<string>;
  abstract testConnection(): Promise<boolean>;
}

// Zonos TTS implementation (local service)
export class ZonosTTS extends BaseTTS {
  async convert(text: string, previousText?: string): Promise<string> {
    try {
      const url = `http://localhost:${this.config.zonosTtsPort}${this.config.zonosTtsEndpoint}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(
          `Server responded with ${response.status}: ${response.statusText}`
        );
      }

      // Save the audio file
      const buffer = Buffer.from(await response.arrayBuffer());
      const outputDir = this.config.outputDir;
      const outputFile = path.join(outputDir, `tts_output_${Date.now()}.wav`);

      fs.writeFileSync(outputFile, buffer);
      logger.info(`Generated TTS audio: ${outputFile}`);

      return outputFile;
    } catch (error) {
      logger.error(
        `TTS conversion error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `http://localhost:${this.config.zonosTtsPort}/health`;
      const response = await fetch(url);
      return response.ok;
    } catch (error) {
      logger.warn(
        `Zonos TTS connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}

// ElevenLabs TTS implementation (external API)
export class ElevenLabsTTS extends BaseTTS {
  async convert(text: string, previousText?: string): Promise<string> {
    try {
      const voiceId = this.config.elevenLabsVoiceId;
      const apiKey = this.config.elevenLabsApiKey;

      if (!apiKey) {
        throw new Error('ElevenLabs API key not found');
      }

      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          previous_text: previousText || '',
          voice_settings: {
            stability: 0.3,
            similarity_boost: 0.5,
            style: 0.5,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `ElevenLabs API error: ${response.status} ${response.statusText}, response: ${await response.text()}`
        );
      }

      // Save the audio file
      const buffer = Buffer.from(await response.arrayBuffer());
      const outputDir = this.config.outputDir;
      const outputFile = path.join(
        outputDir,
        `elevenlabs_tts_${Date.now()}.mp3`
      );

      fs.writeFileSync(outputFile, buffer);
      logger.info(`Generated ElevenLabs TTS audio: ${outputFile}`);

      return outputFile;
    } catch (error) {
      logger.error(
        `ElevenLabs TTS error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const apiKey = this.config.elevenLabsApiKey;

      if (!apiKey) {
        return false;
      }

      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: {
          'xi-api-key': apiKey,
        },
      });

      return response.ok;
    } catch (error) {
      logger.warn(
        `ElevenLabs connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}

// Zonos TTS API implementation
export class ZonosTTSAPI extends BaseTTS {
  private zyphra: Zyphra | null = null;

  constructor(config: Config) {
    super(config);
    this.zyphra = null;
    this.initializeClient();
  }

  initializeClient(): void {
    if (!this.zyphra) {
      if (!this.config.zonosApiKey) {
        throw new Error('Zonos API key not found');
      }
      this.zyphra = new Zyphra({
        apiKey: this.config.zonosApiKey,
      });
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.zyphra) {
        throw new Error('Zyphra client not initialized');
      }
      return await Promise.resolve(true);
    } catch (error) {
      logger.error(
        `Zonos TTS API connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return await Promise.resolve(false);
    }
  }

  async convert(text: string, previousText?: string): Promise<string> {
    try {
      if (!this.zyphra) {
        throw new Error('Zyphra client not initialized');
      }

      if (!this.config.baseAudioPath) {
        throw new Error('Base audio path not found');
      }

      const response = await this.zyphra.audio.speech.create({
        text,
        speaker_audio: fs.readFileSync(this.config.baseAudioPath, 'base64'),
      });

      const audioBuffer = await response.arrayBuffer();
      const audioPath = path.join(
        this.config.outputDir,
        `speech_${Date.now()}.wav`
      );
      fs.writeFileSync(audioPath, Buffer.from(audioBuffer));

      return audioPath;
    } catch (error) {
      logger.error(
        `Zonos TTS API error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}

// Test serve some audio we already have
export class TestTTS extends BaseTTS {
  convert(text: string, previousText?: string): Promise<string> {
    if (!this.config.baseAudioPath) {
      throw new Error('Base audio path not found');
    }
    const audioPath = path.join(this.config.outputDir, 'sample_audio.wav');

    return Promise.resolve(audioPath);
  }

  async testConnection(): Promise<boolean> {
    return await Promise.resolve(true);
  }
}
