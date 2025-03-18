import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export class FileManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Initialize required directories
   */
  async initializeDirectories() {
    const directories = [
      this.config.outputDir,
      path.join(process.cwd(), '../assets')
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
  verifyBaseVideo() {
    if (!fs.existsSync(this.config.baseVideo)) {
      throw new Error(`Base video not found at ${this.config.baseVideo}`);
    }
    logger.info(`Verified base video at ${this.config.baseVideo}`);
  }

  /**
   * Save audio file
   */
  saveAudio(buffer, format = 'wav') {
    const filename = `speech_${Date.now()}.${format}`;
    const filepath = path.join(this.config.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  /**
   * Save video file
   */
  saveVideo(buffer) {
    const filename = `video_${Date.now()}.mp4`;
    const filepath = path.join(this.config.outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  /**
   * Delete file
   */
  deleteFile(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info(`Deleted file: ${filepath}`);
      }
    } catch (error) {
      logger.error(`Failed to delete file ${filepath}: ${error.message}`);
    }
  }
} 