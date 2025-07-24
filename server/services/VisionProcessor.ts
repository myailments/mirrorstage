import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { createSystemPrompt } from '../prompts/system-prompt';
import type { Config } from '../types/index';
import { logger as loggerService } from '../utils/logger';
import type { OBSStream } from './OBSStream';

const logger = {
  info: (message: string) => loggerService.info(message, 'VisionProcessor'),
  warn: (message: string) => loggerService.warn(message, 'VisionProcessor'),
  error: (message: string) => loggerService.error(message, 'VisionProcessor'),
};

interface VisionAnalysis {
  timestamp: string;
  description: string;
  hasChanged: boolean;
  confidence: number;
}

export class VisionProcessor extends EventEmitter {
  private obsStream: OBSStream;
  private config: Config;
  private openai: OpenAI;
  private isActive = false;
  private captureInterval: NodeJS.Timeout | null = null;
  private recentDescriptions: string[] = [];
  private maxDescriptions = 5;
  private screenshotDir: string;
  private sourceName: string;
  private intervalMs: number;

  constructor(obsStream: OBSStream, config: Config) {
    super();
    this.obsStream = obsStream;
    this.config = config;

    // Use OpenRouter if configured, otherwise use OpenAI
    if (config.useOpenRouter && config.openRouterApiKey) {
      this.openai = new OpenAI({
        apiKey: config.openRouterApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': config.openRouterSiteUrl,
          'X-Title': config.openRouterSiteName,
        },
      });
    } else {
      this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    }

    this.screenshotDir = path.join(process.cwd(), 'screenshots');
    this.sourceName = config.visionSourceName || 'Display Capture';
    this.intervalMs = (config.visionIntervalSeconds || 30) * 1000;

    // Ensure screenshot directory exists
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  async start(): Promise<boolean> {
    if (this.isActive) {
      logger.warn('Vision processor already active');
      return true;
    }

    if (!this.obsStream.isConnected()) {
      logger.error('OBS not connected');
      return false;
    }

    this.isActive = true;
    logger.info(`Starting vision processor with ${this.intervalMs}ms interval`);

    // Start capture interval
    this.captureInterval = setInterval(() => {
      this.captureAndAnalyze().catch((error) => {
        logger.error(`Capture error: ${error.message}`);
      });
    }, this.intervalMs);

    // Capture first screenshot immediately
    await this.captureAndAnalyze();

    return true;
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    logger.info('Stopping vision processor');
    this.isActive = false;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    // Clean up remaining screenshots
    this.cleanupScreenshots();
  }

  private async captureAndAnalyze(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      // Capture screenshot
      const timestamp = Date.now();
      const filename = `screenshot-${timestamp}.png`;
      const filepath = path.join(this.screenshotDir, filename);

      logger.info('Capturing screenshot');
      await this.obsStream.captureOneScreenshot(this.sourceName, filepath);

      // Analyze with context
      const analysis = await this.analyzeScreenshot(filepath);

      // Clean up screenshot immediately after analysis
      try {
        fs.unlinkSync(filepath);
      } catch (error) {
        logger.warn(
          `Failed to delete screenshot: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Generate and emit response if something has changed
      if (analysis.hasChanged) {
        logger.info('Scene has changed, generating vision response');
        const response = await this.generateVisionResponse(
          analysis.description
        );
        this.emit('visionResponse', {
          description: analysis.description,
          response,
          timestamp: analysis.timestamp,
        });
      }
    } catch (error) {
      logger.error(
        `Capture and analyze error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async analyzeScreenshot(filepath: string): Promise<VisionAnalysis> {
    try {
      // Read image and convert to base64
      const imageBuffer = await fs.promises.readFile(filepath);
      const base64Image = imageBuffer.toString('base64');

      // Build context from recent descriptions
      const contextPrompt = this.buildContextPrompt();

      // Choose the right model based on configuration
      const model = 'gpt-4o-mini';

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: contextPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: "Describe what you see in this Call of Duty zombies gameplay screenshot. Focus on the action, weapons, environment, zombies, and any notable gameplay moments. Be specific about what's happening.",
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      });

      const content = response.choices[0].message.content || '';

      // Update recent descriptions
      this.recentDescriptions.push(content);
      if (this.recentDescriptions.length > this.maxDescriptions) {
        this.recentDescriptions.shift();
      }

      return {
        timestamp: new Date().toISOString(),
        description: content,
        hasChanged: true,
        confidence: 0.8,
      };
    } catch (error) {
      logger.error(
        `Analysis error: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        timestamp: new Date().toISOString(),
        description: 'Error analyzing screenshot',
        hasChanged: false,
        confidence: 0,
      };
    }
  }

  private async generateVisionResponse(
    sceneDescription: string
  ): Promise<string> {
    try {
      // Choose the right model based on configuration
      const model = this.config.useOpenRouter
        ? this.config.openRouterGenerationModel ||
          'deepseek/deepseek-chat-v3-0324:free'
        : 'gpt-4o-mini';

      const systemPrompt = createSystemPrompt({
        characterName: 'Threadguy',
        context:
          'You are watching a call of duty black ops Nazi Zombies playthruogh. Keep it brief and natural.',
        roleDescription:
          "Provide entertaining commentary about what's happening in the game. Share thoughts, strategies, memories, or reactions to the gameplay - not just noting changes.",
        responseStyle:
          'Plain text only, no formatting. Sound natural when spoken aloud.',
      });

      const userPrompt = `Here's what's happening in the game right now: ${sceneDescription}

Give natural commentary as Threadguy. Talk about the gameplay, share memories about this part of the game, comment on strategies, or react to what's happening. Keep it short (1-2 sentences) and conversational, like you're streaming to your viewers.`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        max_tokens: 150,
        temperature: 0.8,
      });

      const content =
        response.choices[0].message.content ||
        'Something interesting is happening on stream!';
      logger.info(`Generated vision response: ${content.substring(0, 50)}...`);
      return content;
    } catch (error) {
      logger.error(
        `Vision response generation error: ${error instanceof Error ? error.message : String(error)}`
      );
      return 'Looks like something changed on stream!';
    }
  }

  private buildContextPrompt(): string {
    const basePrompt =
      this.config.visionPrompt ||
      'You are analyzing Call of Duty zombies gameplay. Describe the current scene, action, and gameplay elements you see.';

    if (this.recentDescriptions.length === 0) {
      return `${basePrompt}\n\nProvide a detailed description of what's happening in the game.`;
    }

    const recentContext = this.recentDescriptions
      .slice(-3)
      .map((desc, i) => `Previous observation ${i + 1}: ${desc}`)
      .join('\n');

    return `${basePrompt}

Recent observations for context:
${recentContext}

Describe what's currently happening in the game. Focus on the action, gameplay, and any interesting moments.`;
  }

  private cleanupScreenshots(): void {
    try {
      const files = fs.readdirSync(this.screenshotDir);
      const screenshotFiles = files.filter((f) => f.startsWith('screenshot-'));

      for (const file of screenshotFiles) {
        try {
          fs.unlinkSync(path.join(this.screenshotDir, file));
        } catch (error) {
          logger.warn(
            `Failed to delete ${file}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      logger.info(`Cleaned up ${screenshotFiles.length} screenshots`);
    } catch (error) {
      logger.error(
        `Cleanup error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
