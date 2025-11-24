import fs from 'node:fs';
import path from 'node:path';
import { fal } from '@fal-ai/client';
import fetch from 'node-fetch';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import type { VideoSyncService } from './interfaces.js';

/**
 * FAL LatentSync video synchronization service
 *
 * Uses FAL.ai's LatentSync API to generate lip-synced videos
 * from audio input and a base video.
 */
export class VideoSync implements VideoSyncService {
  private config: Config;
  private falClient: typeof fal | null = null;
  private cachedVideoUrl: string | null = null;
  private cachedVideoPath: string | null = null;

  constructor(config: Config) {
    this.config = config;
    this.initializeClient();
  }

  private initializeClient(): void {
    if (!this.falClient) {
      fal.config({ credentials: this.config.falApiKey });
      this.falClient = fal;
    }
  }

  private async getOrUploadFALBaseVideo(
    falClient: typeof fal
  ): Promise<string> {
    // Check if we have a cached video URL and the base video path hasn't changed
    if (
      this.cachedVideoUrl &&
      this.cachedVideoPath === this.config.baseVideoPath
    ) {
      logger.info('Using cached base video URL');
      return this.cachedVideoUrl;
    }

    // Upload the base video and cache the result
    logger.info('Uploading base video to FAL storage');
    const videoFile = fs.readFileSync(this.config.baseVideoPath);
    const videoUrl = await falClient.storage.upload(
      new Blob([new Uint8Array(videoFile)], { type: 'video/mp4' })
    );

    // Cache the URL and path
    this.cachedVideoUrl = videoUrl;
    this.cachedVideoPath = this.config.baseVideoPath;
    logger.info('Base video uploaded and cached');

    return videoUrl;
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

      // Upload audio and get/upload video in parallel
      const [audioUrl, videoUrl] = await Promise.all([
        this.falClient.storage.upload(
          new Blob([new Uint8Array(audioFile)], { type: 'audio/wav' })
        ),
        this.getOrUploadFALBaseVideo(this.falClient),
      ]);

      const result = await this.falClient.subscribe('fal-ai/latentsync', {
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          guidance_scale: 1,
          seed: 42,
          loop_mode: 'loop',
        },
        logs: false,
      });

      if (!result.data?.video?.url) {
        throw new Error('No video URL in FAL.ai response');
      }

      const videoResponse = await fetch(result.data.video.url);
      const videoBuffer = await videoResponse.arrayBuffer();
      const outputPath = path.join(
        this.config.outputDir,
        `video_${Date.now()}.mp4`
      );

      fs.writeFileSync(outputPath, Buffer.from(videoBuffer));
      logger.info(`Generated synchronized video: ${outputPath}`);

      return outputPath;
    } catch (error) {
      logger.error(
        `FAL video sync error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.falClient) {
        return false;
      }
      // FAL doesn't have a direct health check, so we just verify the client exists
      return true;
    } catch (error) {
      logger.warn(
        `FAL API connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}

/**
 * Test video sync service for development/testing
 */
export class TestVideoSync implements VideoSyncService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  process(): Promise<string> {
    if (!this.config.baseVideoPath) {
      throw new Error('Base video path not found');
    }
    const videoPath = path.join(this.config.outputDir, 'sample_video.mp4');
    return Promise.resolve(videoPath);
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}
