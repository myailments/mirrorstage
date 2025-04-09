// Stream analyzer service
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { OBSStream } from './OBSStream.ts';
import { logger as loggerService } from '../utils/logger.ts';
import { Config, StreamAnalysisService } from '../types/index.ts';
import { StreamAnalysisResult } from '../types/index.ts';

const logger = {
  info: (message: string) => {
    loggerService.info(message, StreamAnalysisService.GPT_VISION);
  },
  warn: (message: string) => {
    loggerService.warn(message, StreamAnalysisService.GPT_VISION);
  },
  error: (message: string) => { 
    loggerService.error(message, StreamAnalysisService.GPT_VISION);
  }
};

export class StreamAnalyzer extends EventEmitter {
  private obsStream: OBSStream;
  private config: Config;
  private isAnalyzing: boolean = false;
  private captureSource: string = 'Display Capture'; // Default source name
  private lastAnalysisResult: StreamAnalysisResult | null = null;
  private recentScreenshots: string[] = [];
  private maxRecentScreenshots: number = 5;
  private openai: OpenAI;
  private analysisPrompt: string = 'You are analyzing a livestream. What is happening in this image?';
  
  constructor(obsStream: OBSStream, config: Config) {
    super();
    this.obsStream = obsStream;
    this.config = config;
    
    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: this.config.openaiApiKey,
    });
    
    // Register screenshot callback
    this.obsStream.onScreenshotCaptured(this.processScreenshot.bind(this));
  }
  
  /**
   * Start analyzing the stream from a specific OBS source
   * @param sourceName Name of the OBS source to analyze (e.g. "Display Capture")
   * @param frequencyMs How often to capture and analyze screenshots (milliseconds)
   * @param customPrompt Optional custom prompt to use for analysis
   */
  async startAnalyzing(
    sourceName: string = 'Display Capture', 
    frequencyMs?: number,
    customPrompt?: string
  ): Promise<boolean> {
    this.captureSource = sourceName;
    this.isAnalyzing = true;
    
    if (customPrompt) {
      this.analysisPrompt = customPrompt;
    }
    
    // Get frequency from config if not specified
    const captureFrequency = frequencyMs !== undefined ? frequencyMs : (this.config.visionIntervalSeconds || 30) * 1000;
    
    logger.info(`Starting stream analysis from source "${sourceName}" every ${captureFrequency}ms`);
    
    // Start the screenshot capture
    const result = await this.obsStream.startScreenshotCapture(sourceName, captureFrequency);
    
    if (!result) {
      this.isAnalyzing = false;
      logger.error(`Failed to start capturing from source "${sourceName}"`);
    }
    
    return result;
  }
  
  /**
   * Stop analyzing the stream
   */
  stopAnalyzing(): void {
    logger.info('Stopping stream analysis...');
    this.obsStream.stopScreenshotCapture();
    this.isAnalyzing = false;
    logger.info('Stopped stream analysis');
  }
  
  /**
   * Process a captured screenshot and analyze it
   * @param imagePath Path to the captured screenshot
   */
  private async processScreenshot(imagePath: string): Promise<void> {
    if (!this.isAnalyzing) return;
    
    try {
      logger.info(`Processing screenshot: ${imagePath}`);
      
      // Add to recent screenshots and maintain max length
      this.recentScreenshots.push(imagePath);
      if (this.recentScreenshots.length > this.maxRecentScreenshots) {
        const oldestScreenshot = this.recentScreenshots.shift();
        // Optionally delete old screenshot files to save space
        try {
          if (oldestScreenshot && fs.existsSync(oldestScreenshot)) {
            fs.unlinkSync(oldestScreenshot);
          }
        } catch (error) {
          logger.warn(`Failed to delete old screenshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Analyze the screenshot with the selected AI model
      const analysisResult = await this.analyzeScreenshot(imagePath);
      
      // Save the result
      this.lastAnalysisResult = analysisResult;
      
      // Emit an event with the analysis result
      this.emit('analysis', analysisResult);
      
    } catch (error) {
      logger.error(`Error processing screenshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Analyze a screenshot using GPT-4 Vision
   * @param imagePath Path to the screenshot image
   */
  private async analyzeScreenshot(imagePath: string): Promise<StreamAnalysisResult> {
    try {
      // Read image file and convert to base64
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      logger.info(`Analyzing screenshot with GPT-4 Vision: ${imagePath}`);
      
      // Call OpenAI's API
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: this.analysisPrompt
          },
          {
            role: "user",
            content: [
              { type: "text", text: "You are viewing a livestream. What is happening in this image?" },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 500
      });
      
      logger.info(`AI analysis completed for ${path.basename(imagePath)}`);

    //   delete the image file
    fs.unlinkSync(imagePath);
      
      return {
        timestamp: new Date().toISOString(),
        imagePath: imagePath,
        analysis: {
          description: response.choices[0].message.content || "No description provided",
          model: "gpt-4o-mini",
          tokensUsed: response.usage?.total_tokens || 0
        }
      };
    } catch (error) {
      logger.error(`AI analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      
      // Return a basic result with error info
      return {
        timestamp: new Date().toISOString(),
        imagePath: imagePath,
        analysis: {
          description: `Error analyzing image: ${error instanceof Error ? error.message : String(error)}`,
          model: "gpt-4o-mini",
          tokensUsed: 0
        }
      };
    }
  }
  
  /**
   * Get the most recent analysis result
   */
  getLastAnalysisResult(): StreamAnalysisResult | null {
    return this.lastAnalysisResult;
  }
  
  /**
   * Get paths to the most recent screenshots
   */
  getRecentScreenshots(): string[] {
    return [...this.recentScreenshots];
  }
  
  /**
   * Force an immediate analysis of the current state
   */
  async analyzeNow(): Promise<StreamAnalysisResult | null> {
    if (!this.obsStream.isConnected()) {
      throw new Error('OBS is not connected');
    }
    
    try {
      // Capture a screenshot immediately
      const screenshotPath = await this.obsStream.captureOneScreenshot(this.captureSource);
      
      // Process it
      await this.processScreenshot(screenshotPath);
      
      return this.lastAnalysisResult;
    } catch (error) {
      logger.error(`Failed to analyze now: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}