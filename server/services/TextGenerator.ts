import { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { OpenAI } from 'openai';
import { createSystemPrompt } from '../prompts/system_prompt.js';
export class TextGenerator {
  private config: Config;
  private openai?: OpenAI;
  private openRouter?: OpenAI;
  private useDeepseek: boolean;
  private useOpenRouter: boolean;

  constructor(config: Config) {
    this.config = config;
    this.useDeepseek = config.useDeepseekLocal || false;
    this.useOpenRouter = config.useOpenRouter || false;
    
    if (!this.useDeepseek && !this.useOpenRouter) {
      this.openai = new OpenAI({
        apiKey: this.config.openaiApiKey,
      });
    }
    
    if (this.useOpenRouter) {
      this.openRouter = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: this.config.openRouterApiKey,
        defaultHeaders: {
          "HTTP-Referer": this.config.openRouterSiteUrl || "",
          "X-Title": this.config.openRouterSiteName || "",
        },
      });
    }
  }

  /**
   * Generate a response to user input
   */
  async generateText(userInput: string): Promise<string> {
    const systemPrompt = createSystemPrompt({ context: 'You are to be responding to a livestreaming audience as part of an AI pipeline. Your text will be turned into a talking head video, so keep it short and concise, and be sure to emphasize the use of tone, but not style. Your responses should be formatted to be machine-readable and read aloud by an AI voice.' });
 
    try {
      if (this.useDeepseek) {
        return await this.generateWithDeepseek(userInput, systemPrompt);
      } else if (this.useOpenRouter) {
        return await this.generateWithOpenRouter(userInput, systemPrompt);
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

  private async generateWithOpenRouter(userInput: string, systemPrompt: string): Promise<string> {
    if (!this.openRouter) {
      throw new Error('OpenRouter client not initialized');
    }

    const model = this.config.openRouterModel || "deepseek/deepseek-chat-v3-0324:free";

    
    const completion = await this.openRouter.chat.completions.create({
      model: model,
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
      throw new Error('Empty response from OpenRouter');
    }
    
    return response;
  }

  private async generateWithDeepseek(userInput: string, systemPrompt: string): Promise<string> {
    const endpoint = `http://localhost:${this.config.deepseekPort}${this.config.deepseekEndpoint}/chat/completions`;
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        })
      });

      const data = await response.json();
      const content = data.choices[0]?.message?.content?.trim();
      
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
        const response = await fetch(endpoint);
        const data = await response.json();
        return Array.isArray(data.data) && data.data.length > 0;
      } else if (this.useOpenRouter && this.openRouter) {
        // For OpenRouter, we can't use models.list, so we'll make a simple completion request
        const completion = await this.openRouter.chat.completions.create({
          model: this.config.openRouterModel || "deepseek/deepseek-chat-v3-0324:free",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 5
        });
        return completion.choices.length > 0;
      } else if (this.openai) {
        const models = await this.openai.models.list();
        return models.data.length > 0;
      }
      return false;
    } catch (error) {
      let provider = 'OpenAI';
      if (this.useDeepseek) provider = 'Deepseek';
      if (this.useOpenRouter) provider = 'OpenRouter';
      
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
