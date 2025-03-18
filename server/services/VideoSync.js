// Base VideoSync class
class VideoSync {
  async process(audioPath) {
    throw new Error('Not implemented');
  }
}

export class LocalLatentSync extends VideoSync {
  constructor(options) {
    super();
    this.baseUrl = options.baseUrl || config.baseUrl;
    this.port = options.latentSyncPort || config.latentSyncPort;
    this.endpoint = options.latentSyncEndpoint || config.latentsyncEndpoint;
    this.baseVideo = options.baseVideo || config.baseVideoPath;
  }

  async process(audioPath) {
    try {
      const formData = new FormData();
      formData.append('video', fs.createReadStream(this.baseVideo));
      formData.append('audio', fs.createReadStream(audioPath));

      const response = await fetch(`${this.baseUrl}:${this.port}${this.endpoint}`, {
        method: 'POST',
        body: formData,
        timeout: 120000
      });

      if (!response.ok) {
        throw new Error('LatentSync API error');
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
  constructor(options) {
    super();
    this.apiKey = options.falApiKey || process.env.FAL_KEY;
    this.baseVideo = options.baseVideo || config.baseVideoPath;
    
    fal.config({ credentials: this.apiKey });
  }

  async process(audioPath) {
    try {
      const audioFile = fs.readFileSync(audioPath);
      const videoFile = fs.readFileSync(this.baseVideo);
      
      const [audioUrl, videoUrl] = await Promise.all([
        fal.storage.upload(new Blob([audioFile], { type: 'audio/wav' })),
        fal.storage.upload(new Blob([videoFile], { type: 'video/mp4' }))
      ]);

      const result = await fal.subscribe("fal-ai/latentsync", {
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          guidance_scale: 1,
          loop_mode: "loop"
        },
        logs: false
      });

      if (!result.data?.video?.url) {
        throw new Error('No video URL in FAL.ai response');
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