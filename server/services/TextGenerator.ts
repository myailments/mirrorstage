import { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { OpenAI } from 'openai';
import axios from 'axios';

export class TextGenerator {
  private config: Config;
  private openai?: OpenAI;
  private useDeepseek: boolean;

  constructor(config: Config) {
    this.config = config;
    this.useDeepseek = config.useDeepseekLocal || false;
    
    if (!this.useDeepseek) {
      this.openai = new OpenAI({
        apiKey: this.config.openaiApiKey,
      });
    }
  }

  /**
   * Generate a response to user input
   */
  async generateText(userInput: string): Promise<string> {
    const systemPrompt = `You are a helpful AI assistant in a live-streaming context. 
    Respond to user messages in a way that is:
    1. Engaging and conversational
    2. Brief (2-3 sentences) but informative
    3. Friendly and supportive
    4. Natural for video format
    
    Your responses will be turned into a talking head video, so keep them concise and conversational.`;

    try {
      if (this.useDeepseek) {
        return await this.generateWithDeepseek(userInput, systemPrompt);
      } else {
        return await this.generateWithOpenAI(userInput, systemPrompt);
      }
    } catch (error) {
      logger.error(`Text generation error: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback response
      return "I'm sorry, I couldn't process that request. Could you please try again?";
    }
  }

  private async generateWithOpenAI(userInput: string, systemPrompt: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
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
  }

  private async generateWithDeepseek(userInput: string, systemPrompt: string): Promise<string> {
    const endpoint = `http://localhost:${this.config.deepseekPort}${this.config.deepseekEndpoint}/chat/completions`;
    
    try {
      const response = await axios.post(endpoint, {
        model: "deepseek-coder-v3",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userInput
          }
        ],
        max_tokens: 150
      });

      const content = response.data.choices[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('Empty response from Deepseek');
      }
      
      return content;
    } catch (error) {
      logger.error(`Deepseek API error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Test connection to LLM API
   */
  async testConnection(): Promise<boolean> {
    try {
      if (this.useDeepseek) {
        const endpoint = `http://localhost:${this.config.deepseekPort}${this.config.deepseekEndpoint}/models`;
        const response = await axios.get(endpoint);
        return Array.isArray(response.data.data) && response.data.data.length > 0;
      } else if (this.openai) {
        const models = await this.openai.models.list();
        return models.data.length > 0;
      }
      return false;
    } catch (error) {
      const provider = this.useDeepseek ? 'Deepseek' : 'OpenAI';
      logger.warn(`${provider} connection test failed: ${error instanceof Error ? error.message : String(error)}`);
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
