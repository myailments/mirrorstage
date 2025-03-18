import { OpenAI } from 'openai';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

export class TextGenerator {
  constructor(config) {
    this.config = config;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Generate response text using primary API or fallback to OpenAI
   */
  async generateText(message) {
    try {
      return await this.useCloudyAPI(message);
    } catch (error) {
      logger.warn(`Cloudy API failed, falling back to OpenAI: ${error.message}`);
      return await this.useOpenAI(message);
    }
  }

  /**
   * Use Cloudy API for text generation
   */
  async useCloudyAPI(message) {
    const response = await fetch(`${process.env.CLOUDY_AI_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message, 
        userId: 'user_1', 
        roomId: 'pipeline_development' 
      })
    });

    if (!response.ok) {
      throw new Error('Chat API error');
    }

    const data = await response.json();
    return data.message;
  }

  /**
   * Fallback to OpenAI for text generation
   */
  async useOpenAI(message) {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are a helpful AI assistant. Keep responses natural and between 30-60 words."
        },
        { role: "user", content: message }
      ],
      max_tokens: 150
    });

    return completion.choices[0].message.content;
  }

  /**
   * Test connection to text generation services
   */
  async testConnection() {
    try {
      // Test Cloudy API
      const cloudyResponse = await fetch(`${process.env.CLOUDY_AI_API_URL}/health`);
      if (!cloudyResponse.ok) {
        logger.warn('Cloudy API health check failed');
      }

      // Test OpenAI
      await this.openai.models.list();
      logger.info('OpenAI connection verified');
      
      return true;
    } catch (error) {
      logger.error(`Text generation service test failed: ${error.message}`);
      throw error;
    }
  }
} 