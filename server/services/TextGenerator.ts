import { OpenAI } from 'openai';
import { createSystemPrompt } from '../prompts/system-prompt.js';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import type { ConversationMemory } from './ConversationMemory.js';

export class TextGenerator {
  private config: Config;
  private openai?: OpenAI;
  private openRouter?: OpenAI;
  private useOpenRouter: boolean;
  private conversationMemory?: ConversationMemory;

  constructor(config: Config) {
    this.config = config;
    this.useOpenRouter = config.useOpenRouter;

    if (!this.useOpenRouter) {
      this.openai = new OpenAI({
        apiKey: this.config.openaiApiKey,
      });
    }

    if (this.useOpenRouter) {
      this.openRouter = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: this.config.openRouterApiKey,
        defaultHeaders: {
          'HTTP-Referer': this.config.openRouterSiteUrl || '',
          'X-Title': this.config.openRouterSiteName || '',
        },
      });
    }
  }

  /**
   * Set the conversation memory instance
   */
  setConversationMemory(memory: ConversationMemory): void {
    this.conversationMemory = memory;
  }

  /**
   * Generate a response to user input
   */
  async generateText(
    userInput: string,
    context?: string[],
    userId?: string
  ): Promise<string> {
    // Get conversation context and analytics
    let conversationContext = '';
    let dynamicGuidance = '';

    if (this.conversationMemory) {
      conversationContext = this.conversationMemory.formatContextForPrompt(
        20,
        userId
      );
      const analytics = this.conversationMemory.analyzeConversation(30);

      // Add dynamic guidance based on analytics
      if (analytics.repetitionScore > 0.5) {
        dynamicGuidance = '\nBe creative and explore new ideas. ';
      }
      if (analytics.conversationFlow === 'thought-heavy') {
        dynamicGuidance += 'Focus on responding directly to the user. ';
      }

      // Add dynamic response length guidance
      const recentResponses = this.conversationMemory.getRecentInteractions(
        3,
        'bot_response'
      );
      const avgLength =
        recentResponses.length > 0
          ? recentResponses.reduce((sum, r) => sum + r.content.length, 0) /
            recentResponses.length
          : 100;

      // Vary response length to be more human-like
      const randomFactor = Math.random();
      if (avgLength > 200) {
        // Recent responses were long, make this one shorter
        dynamicGuidance +=
          '\nKeep this response brief and concise - just a sentence or two. ';
      } else if (avgLength < 50) {
        // Recent responses were short, make this one longer
        dynamicGuidance +=
          '\nElaborate more in this response - share some details or examples. ';
      } else if (randomFactor < 0.3) {
        // 30% chance for a very short response
        dynamicGuidance += '\nGive a quick, casual response. ';
      } else if (randomFactor > 0.7) {
        // 30% chance for a longer response
        dynamicGuidance += '\nShare a bit more detail or tell a brief story. ';
      }
    } else if (context) {
      // Fallback to old context format
      conversationContext = `Recent messages:\n${context.join('\n')}\n\n`;
    }

    // Create system prompt with configurable parameters
    const systemPrompt = createSystemPrompt({
      characterName: 'Threadguy',
      context: `Your text will be turned into a talking head video, so keep it short and concise. ${dynamicGuidance}\n\n${conversationContext}`,
      roleDescription:
        'You are a livestreamer as part of an AI pipeline. Respond naturally and engage with the audience.',
      responseStyle:
        'Be sure to emphasize the use of tone, but not style. Your responses should be formatted to be machine-readable and read aloud by an AI voice. Do not use markdown or other formatting. Just plain text.',
    });

    try {
      if (this.useOpenRouter) {
        return await this.generateWithOpenRouter(userInput, systemPrompt);
      }
      return await this.generateWithOpenAI(userInput, systemPrompt);
    } catch (error) {
      logger.error(
        `Text generation error: ${error instanceof Error ? error.message : String(error)}`
      );
      // Fallback response
      return "I'm sorry, I couldn't process that request. Could you please try again?";
    }
  }

  private async generateWithOpenAI(
    userInput: string,
    systemPrompt: string
  ): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userInput,
        },
      ],
      max_tokens: 150,
    });

    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      throw new Error('Empty response from OpenAI');
    }

    return response;
  }

  private async generateWithOpenRouter(
    userInput: string,
    systemPrompt: string
  ): Promise<string> {
    if (!this.openRouter) {
      throw new Error('OpenRouter client not initialized');
    }

    const model =
      this.config.openRouterGenerationModel ||
      'deepseek/deepseek-chat-v3-0324:free';

    const completion = await this.openRouter.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userInput,
        },
      ],
      max_tokens: 300,
    });

    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      throw new Error('Empty response from OpenRouter');
    }

    return response;
  }

  /**
   * Test connection to LLM API
   */
  async testConnection(): Promise<boolean> {
    try {
      if (this.useOpenRouter && this.openRouter) {
        // For OpenRouter, we can't use models.list, so we'll make a simple completion request
        const completion = await this.openRouter.chat.completions.create({
          model:
            this.config.openRouterGenerationModel ||
            'deepseek/deepseek-chat-v3-0324:free',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5,
        });
        return completion.choices.length > 0;
      }
      if (this.openai) {
        const models = await this.openai.models.list();
        return models.data.length > 0;
      }
      return false;
    } catch (error) {
      const provider = this.useOpenRouter ? 'OpenRouter' : 'OpenAI';

      logger.warn(
        `${provider} connection test failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}

// Test text generator
export class TestTextGenerator extends TextGenerator {
  generateText(): Promise<string> {
    return Promise.resolve('Test response');
  }

  async testConnection(): Promise<boolean> {
    return await Promise.resolve(true);
  }
}
