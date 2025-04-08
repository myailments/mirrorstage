import { Config } from "../types/index.js";
import { VideoSyncService } from "./interfaces.js";
import { logger } from "../utils/logger.js";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";
import { fal } from "@fal-ai/client";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
      formData.append("audio", fs.createReadStream(audioPath));
      formData.append("video", fs.createReadStream(this.config.baseVideoPath));

      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          `Server responded with ${response.status}: ${response.statusText}`
        );
      }

      // Save the video file
      const buffer = Buffer.from(await response.arrayBuffer());
      const outputDir = this.config.outputDir;
      const outputFile = path.join(outputDir, `video_${Date.now()}.mp4`);

      fs.writeFileSync(outputFile, buffer);
      logger.info(`Generated synchronized video: ${outputFile}`);

      return outputFile;
    } catch (error) {
      logger.error(
        `Video sync error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `http://localhost:${this.config.latentSyncPort}/health`;
      const response = await fetch(url);
      return response.ok;
    } catch (error) {
      logger.warn(
        `LocalLatentSync connection test failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
        throw new Error("FAL API key not found");
      }

      if (!this.falClient) {
        throw new Error("FAL client initialization failed");
      }

      const audioFile = fs.readFileSync(audioPath);
      const videoFile = fs.readFileSync(this.config.baseVideoPath);

      const [audioUrl, videoUrl] = await Promise.all([
        this.falClient.storage.upload(
          new Blob([audioFile], { type: "audio/wav" })
        ),
        this.falClient.storage.upload(
          new Blob([videoFile], { type: "video/mp4" })
        ),
      ]);

      const result = await this.falClient.subscribe("fal-ai/latentsync", {
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
      const videoPath = path.join(
        this.config.outputDir,
        `video_${Date.now()}.mp4`
      );

      fs.writeFileSync(videoPath, Buffer.from(videoBuffer));
      return videoPath;
    } catch (error) {
      logger.error(
        `FAL video sync error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
      logger.warn(
        `FAL API connection test failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }
}

// Sync Labs implementation
export class SyncLabsSync extends BaseVideoSync {
  private apiKey: string;
  private s3Client: S3Client;
  private bucketName: string;

  constructor(config: Config) {
    super(config);
    if (!config.syncLabsKey) {
      throw new Error("Sync Labs API key is required");
    }
    this.apiKey = config.syncLabsKey;

    // Initialize S3 client
    this.s3Client = new S3Client({
      region: config.awsRegion || "us-east-1",
      credentials: {
        accessKeyId: config.awsAccessKeyId || "",
        secretAccessKey: config.awsSecretAccessKey || "",
      },
    });
    this.bucketName = config.awsBucketName || "";
  }

  async process(audioPath: string): Promise<string> {
    try {
      // Upload audio file to S3
      const audioFileName = `synclabs/audio/${Date.now()}.wav`;
      const audioFile = fs.readFileSync(audioPath);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: audioFileName,
          Body: audioFile,
          ContentType: "audio/wav",
        })
      );

      const audioUrl = `https://${this.bucketName}.s3.${this.config.awsRegion}.amazonaws.com/${audioFileName}`;
      logger.info(`Audio uploaded to S3: ${audioUrl}`);

      const videoFileName = `synclabs/video/${Date.now()}.mp4`;
      const videoFile = fs.readFileSync(this.config.baseVideoPath);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: videoFileName,
          Body: videoFile,
          ContentType: "video/mp4",
        })
      );

      const videoUrl = `https://${this.bucketName}.s3.${this.config.awsRegion}.amazonaws.com/${videoFileName}`;
      logger.info(`Video uploaded to S3: ${videoUrl}`);

      const syncLabsUrl = "https://api.sync.so/v2/generate";

      const headers = {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      };

      const payload = {
        model: "lipsync-2",
        options: {
          output_format: "mp4",
        },
        input: [
          {
            type: "video",
            url: videoUrl,
          },
          {
            type: "audio",
            url: audioUrl,
          },
    
        ],
      };
      const response = await fetch(syncLabsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      let jobId = "";
      if (response.status === 201) {
        const data = (await response.json()) as { id: string };
        logger.info(`Sync Labs job initiated: ${data.id}`);
        jobId = data.id;
      } else {
        const errorText = await response.text();
        logger.error(
          `Sync Labs API error: ${response.status} ${response.statusText} - ${errorText}`
        );
        throw new Error(`Failed to submit generation: ${response.status}`);
      }

      // Poll for completion
      const outputUrl = await this.pollForCompletion(jobId);

      // Download and save the video
      const videoResponse = await fetch(outputUrl);
      const videoBuffer = await videoResponse.arrayBuffer();
      const outputPath = path.join(
        this.config.outputDir,
        `synclabs_${jobId}.mp4`
      );

      fs.writeFileSync(outputPath, Buffer.from(videoBuffer));
      logger.info(`Sync Labs video downloaded: ${outputPath}`);

      return outputPath;
    } catch (error) {
      logger.error(
        `Sync Labs processing error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  private async pollForCompletion(jobId: string): Promise<string> {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await fetch(`https://api.sync.so/v2/generate/${jobId}`, {
        headers: {
          "x-api-key": this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to check job status: ${response.status}`);
      }

      const jobStatus = (await response.json()) as {
        status: string;
        outputUrl?: string;
        error?: string;
      };

      const terminalStatuses = ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"];

      if (terminalStatuses.includes(jobStatus.status)) {
        if (jobStatus.status === "COMPLETED" && jobStatus.outputUrl) {
          return jobStatus.outputUrl;
        } else {
          throw new Error(
            `Sync Labs job failed with status ${jobStatus.status}: ${
              jobStatus.error || "Unknown error"
            }`
          );
        }
      }

      // Wait 10 seconds before next attempt
      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }

    throw new Error("Sync Labs job timed out");
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch("https://api.sync.so/v2/generate", {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "lipsync-1.9.0-beta",
          input: [],
        }),
      });
      return response.status !== 401; // Check if authentication works
    } catch (error) {
      logger.warn(
        `Sync Labs connection test failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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

// // MuseTalk implementation
// export class MuseTalkSync extends BaseVideoSync {
//   async process(audioPath: string): Promise<string> {
//     try {
//       const url = `http://localhost:${this.config.museTalkPort}${this.config.museTalkEndpoint}`;

//       const formData = new FormData();
//       formData.append('audio', fs.createReadStream(audioPath));
//       formData.append('video', fs.createReadStream(this.config.baseVideoPath));

//       const response = await fetch(url, {
//         method: 'POST',
//         body: formData,
//       });

//       if (!response.ok) {
//         throw new Error(`MuseTalk server responded with ${response.status}: ${response.statusText}`);
//       }

//       // Save the video file
//       const buffer = Buffer.from(await response.arrayBuffer());
//       const outputDir = this.config.outputDir;
//       const outputFile = path.join(outputDir, `musetalk_${Date.now()}.mp4`);

//       fs.writeFileSync(outputFile, buffer);
//       logger.info(`Generated MuseTalk video: ${outputFile}`);

//       return outputFile;
//     } catch (error) {
//       logger.error(`MuseTalk sync error: ${error instanceof Error ? error.message : String(error)}`);
//       throw error;
//     }
//   }

//   async testConnection(): Promise<boolean> {
//     try {
//       const url = `http://localhost:${this.config.museTalkPort}/health`;
//       const response = await fetch(url);
//       return response.ok;
//     } catch (error) {
//       logger.warn(`MuseTalk connection test failed: ${error instanceof Error ? error.message : String(error)}`);
//       return false;
//     }
//   }
// }
