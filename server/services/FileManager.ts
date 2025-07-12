import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class FileManager {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Initialize required directories
   */
  initializeDirectories(): void {
    const directories = [
      this.config.outputDir,
      path.join(process.cwd(), '../assets'),
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
      }
    }
  }

  /**
   * Verify base video exists
   */
  verifyBaseVideo(): void {
    if (!fs.existsSync(this.config.baseVideoPath)) {
      throw new Error(`Base video not found at ${this.config.baseVideoPath}`);
    }
    logger.info(`Verified base video at ${this.config.baseVideoPath}`);
  }

  /**
   * Get speaker audio file
   */
  verifyBaseAudio(): void {
    const baseAudioPath = this.config.baseAudioPath;
    if (!baseAudioPath) {
      throw new Error('Base audio path is not defined in config');
    }
    if (!fs.existsSync(baseAudioPath)) {
      throw new Error(`Base audio not found at ${baseAudioPath}`);
    }
    logger.info(`Verified base audio at ${baseAudioPath}`);
  }

  /**
   * Save audio file
   */
  saveAudio(buffer: Buffer, format = 'wav'): string {
    const filename = `speech_${Date.now()}.${format}`;
    const filepath = path.join(this.config.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  /**
   * Save video file
   */
  saveVideo(buffer: Buffer): string {
    const filename = `video_${Date.now()}.mp4`;
    const filepath = path.join(this.config.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  /**
   * Delete file
   */
  deleteFile(filepath: string): void {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info(`Deleted file: ${filepath}`);
      }
    } catch (error) {
      logger.error(
        `Failed to delete file ${filepath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
