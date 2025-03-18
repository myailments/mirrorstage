import fs from "fs";
import path from "path";
import { fal } from "@fal-ai/client";
import { logger } from "../utils/logger.js";

// Base VideoSync class
class VideoSync {
  async process(audioPath) {
    throw new Error("Not implemented");
  }
}

export class LocalLatentSync extends VideoSync {
  constructor(config) {
    super();
    this.baseUrl = config.baseUrl;
    this.port = config.latentSyncPort;
    this.endpoint = config.latentsyncEndpoint;
    this.baseVideo = config.baseVideoPath;
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}:${this.port}/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      });

      if (!response.ok) {
        throw new Error(
          `LocalLatentSync service unavailable: ${response.status}`
        );
      }

      return true;
    } catch (error) {
      logger.error(`LocalLatentSync connection test failed: ${error.message}`);
      return false;
    }
  }

  async process(audioPath) {
    try {
      const formData = new FormData();
      formData.append("video", fs.createReadStream(this.baseVideo));
      formData.append("audio", fs.createReadStream(audioPath));

      const response = await fetch(
        `${this.baseUrl}:${this.port}${this.endpoint}`,
        {
          method: "POST",
          body: formData,
          timeout: 120000,
        }
      );

      if (!response.ok) {
        throw new Error("LatentSync API error");
      }

      const videoBuffer = await response.arrayBuffer();
      const videoPath = path.join(config.outputDir, `video_${Date.now()}.mp4`);
      fs.writeFileSync(videoPath, Buffer.from(videoBuffer));

      return videoPath;
    } catch (error) {
      logger.error(`LocalLatentSync error: ${error.message}`);
      throw error;
    }
  }
}

export class FalLatentSync extends VideoSync {
  constructor(config) {
    super();
    this.apiKey = config.falApiKey || process.env.FAL_KEY;
    this.baseVideo = config.baseVideoPath;

    fal.config({ credentials: this.apiKey });
  }

  async testConnection() {
    try {
      if (!this.apiKey) {
        throw new Error("FalLatentSync API key not found");
      }

      return true;
    } catch (error) {
      logger.error(`FalLatentSync connection test failed: ${error.message}`);
      return false;
    }
  }

  async process(audioPath) {
    try {
      const audioFile = fs.readFileSync(audioPath);
      const videoFile = fs.readFileSync(this.baseVideo);

      const [audioUrl, videoUrl] = await Promise.all([
        fal.storage.upload(new Blob([audioFile], { type: "audio/wav" })),
        fal.storage.upload(new Blob([videoFile], { type: "video/mp4" })),
      ]);

      const result = await fal.subscribe("fal-ai/latentsync", {
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          guidance_scale: 1,
          loop_mode: "loop",
        },
        logs: false,
      });

      if (!result.data?.video?.url) {
        throw new Error("No video URL in FAL.ai response");
      }

      const videoResponse = await fetch(result.data.video.url);
      const videoBuffer = await videoResponse.arrayBuffer();
      const videoPath = path.join(config.outputDir, `video_${Date.now()}.mp4`);

      fs.writeFileSync(videoPath, Buffer.from(videoBuffer));
      return videoPath;
    } catch (error) {
      logger.error(`FalLatentSync error: ${error.message}`);
      throw error;
    }
  }
}
