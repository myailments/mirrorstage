import { Config } from '../types/index.js';
import { VideoSyncService } from './interfaces.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { fal } from '@fal-ai/client';


// Base VideoSync class
abstract class BaseVideoSync implements VideoSyncService {
  protected config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  abstract process(audioPath: string): Promise<string>;
  abstract testConnection(): Promise<boolean>;
}

// LocalLatentSync implementation
export class LocalLatentSync extends BaseVideoSync {
  async process(audioPath: string): Promise<string> {
    try {
      const url = `http://localhost:${this.config.latentSyncPort}${this.config.latentsyncEndpoint}`;
      
      const formData = new FormData();
      formData.append('audio', fs.createReadStream(audioPath));
      formData.append('video', fs.createReadStream(this.config.baseVideoPath));
      
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      // Save the video file
      const buffer = Buffer.from(await response.arrayBuffer());
      const outputDir = this.config.outputDir;
      const outputFile = path.join(outputDir, `video_${Date.now()}.mp4`);
      
      fs.writeFileSync(outputFile, buffer);
      logger.info(`Generated synchronized video: ${outputFile}`);
      
      return outputFile;
    } catch (error) {
      logger.error(`Video sync error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `http://localhost:${this.config.latentSyncPort}/health`;
      const response = await fetch(url);
      return response.ok;
    } catch (error) {
      logger.warn(`LocalLatentSync connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

// FAL LatentSync implementation (external API)
export class FalLatentSync extends BaseVideoSync {
  private falClient: typeof fal | null;

  constructor(config: Config) {
    super(config);
    this.falClient = null;
    this.initializeClient();
  }

  async initializeClient(): Promise<void> {
    if (!this.falClient) {
      fal.config({ credentials: this.config.falApiKey });
      this.falClient = fal;
    }
  }

  async process(audioPath: string): Promise<string> {
    try {
      if (!this.config.falApiKey) {
        throw new Error('FAL API key not found');
      }

      if (!this.falClient) {
        throw new Error('FAL client initialization failed');
      }

      const audioFile = fs.readFileSync(audioPath);
      const videoFile = fs.readFileSync(this.config.baseVideoPath);


      const [audioUrl, videoUrl] = await Promise.all([
        this.falClient.storage.upload(new Blob([audioFile], { type: "audio/wav" })),
        this.falClient.storage.upload(new Blob([videoFile], { type: "video/mp4" })),
      ]);

      const result = await this.falClient.subscribe('fal-ai/latentsync', {
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          guidance_scale: 1,
          // @ts-ignore
          loop_mode: "loop",
          // @ts-ignore
          seed: 42,
        },
        logs: false,
      });

      if (!result.data?.video?.url) {
        throw new Error("No video URL in FAL.ai response");
      }

      const videoResponse = await fetch(result.data.video.url);
      const videoBuffer = await videoResponse.arrayBuffer();
      const videoPath = path.join(this.config.outputDir, `video_${Date.now()}.mp4`);

      fs.writeFileSync(videoPath, Buffer.from(videoBuffer));
      return videoPath;
    } catch (error) {
      logger.error(`FAL video sync error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.falClient) {
        return false;
      }      
      // In the real implementation, we would test the API connection
      return true;
    } catch (error) {
      logger.warn(`FAL API connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

// Test serve a video we already have
export class TestVideoSync extends BaseVideoSync {
  async process(audioPath: string): Promise<string> {
    if (!this.config.baseVideoPath) {
      throw new Error("Base video path not found");
    }
    const videoPath = path.join(this.config.outputDir, `sample_video.mp4`);
  return videoPath;
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

// MuseTalk implementation
export class MuseTalkSync extends BaseVideoSync {
  async process(audioPath: string): Promise<string> {
    try {
      const url = `http://localhost:${this.config.museTalkPort}${this.config.museTalkEndpoint}`;
      
      const formData = new FormData();
      formData.append('audio', fs.createReadStream(audioPath));
      formData.append('video', fs.createReadStream(this.config.baseVideoPath));
      
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`MuseTalk server responded with ${response.status}: ${response.statusText}`);
      }

      // Save the video file
      const buffer = Buffer.from(await response.arrayBuffer());
      const outputDir = this.config.outputDir;
      const outputFile = path.join(outputDir, `musetalk_${Date.now()}.mp4`);
      
      fs.writeFileSync(outputFile, buffer);
      logger.info(`Generated MuseTalk video: ${outputFile}`);
      
      return outputFile;
    } catch (error) {
      logger.error(`MuseTalk sync error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `http://localhost:${this.config.museTalkPort}/health`;
      const response = await fetch(url);
      return response.ok;
    } catch (error) {
      logger.warn(`MuseTalk connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
