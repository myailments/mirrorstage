import { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { OpenAI } from 'openai';

export class TextGenerator {
  private config: Config;
  private openai: OpenAI;

  constructor(config: Config) {
    this.config = config;
    this.openai = new OpenAI({
      apiKey: this.config.openaiApiKey,
    });
  }

  /**
   * Generate a response to user input
   */
  async generateText(userInput: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a helpful AI assistant in a live-streaming context. 
            Respond to user messages in a way that is:
            1. Engaging and conversational
            2. Brief (2-3 sentences) but informative
            3. Friendly and supportive
            4. Natural for video format
            
            Your responses will be turned into a talking head video, so keep them concise and conversational.`
          },
          {
            role: "user",
            content: userInput
          }
        ],
        max_tokens: 150
      });

      const response = completion.choices[0]?.message?.content?.trim();
      
      if (!response) {
        throw new Error('Empty response from OpenAI');
      }
      
      return response;
    } catch (error) {
      logger.error(`Text generation error: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback response
      return "I'm sorry, I couldn't process that request. Could you please try again?";
    }
  }

  /**
   * Test connection to OpenAI API
   */
  async testConnection(): Promise<boolean> {
    try {
      const models = await this.openai.models.list();
      return models.data.length > 0;
    } catch (error) {
      logger.warn(`OpenAI connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

// Test text generator
export class TestTextGenerator extends TextGenerator {
  async generateText(userInput: string): Promise<string> {
    return "Test response";
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}
