import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

// Base TTS class
class TTS {
  async convert(text) {
    throw new Error('Not implemented');
  }
}

export class ZonosTTS extends TTS {
  constructor(config) {
    super();
    this.baseUrl = config.baseUrl;
    this.port = config.zonosTtsPort;
    this.endpoint = config.zonosTtsEndpoint;
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}:${this.port}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`Zonos TTS service unavailable: ${response.status}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Zonos TTS connection test failed: ${error.message}`);
      return false;
    }
  }

  async convert(text) {
    try {
      const response = await fetch(`${this.baseUrl}:${this.port}${this.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioPath = path.join(config.outputDir, `speech_${Date.now()}.wav`);
      fs.writeFileSync(audioPath, Buffer.from(audioBuffer));
      
      return audioPath;
    } catch (error) {
      logger.error(`TTS error: ${error.message}`);
      throw error;
    }
  }
}

export class ElevenLabsTTS extends TTS {
  constructor(config) {
    super();
    this.apiKey = config.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
    this.voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
  }

  async testConnection() {
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'xi-api-key': this.apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`ElevenLabs service unavailable: ${response.status}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`ElevenLabs connection test failed: ${error.message}`);
      return false;
    }
  }

  async convert(text) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.85,
            similarity_boost: 0.95,
            style: 0.35,
            use_speaker_boost: true
          }
        })
      });

      if (!response.ok) {
        throw new Error('ElevenLabs API error');
      }

      const audioBuffer = await response.arrayBuffer();
      const audioPath = path.join(config.outputDir, `speech_${Date.now()}.mp3`);
      fs.writeFileSync(audioPath, Buffer.from(audioBuffer));
      
      return audioPath;
    } catch (error) {
      logger.error(`ElevenLabs error: ${error.message}`);
      throw error;
    }
  }
} 