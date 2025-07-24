import { OpenAI } from 'openai';
import { createSystemPrompt } from '../prompts/system-prompt.js';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class ThoughtGenerator {
  private config: Config;
  private openai?: OpenAI;
  private openRouter?: OpenAI;
  private useOpenRouter: boolean;
  private thoughtHistory: string[] = [];
  private maxHistorySize = 10;

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

  async generateThought(): Promise<string> {
    const systemPrompt = this.createThoughtSystemPrompt();

    try {
      const thought = this.useOpenRouter
        ? await this.generateWithOpenRouter(systemPrompt)
        : await this.generateWithOpenAI(systemPrompt);

      this.addToHistory(thought);
      logger.info(`Generated thought: ${thought.substring(0, 50)}...`);
      return thought;
    } catch (error) {
      logger.error(
        `Thought generation error: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.getFallbackThought();
    }
  }

  private createThoughtSystemPrompt(): string {
    const historyContext =
      this.thoughtHistory.length > 0
        ? `Previous thoughts (avoid repeating these concepts): ${this.thoughtHistory.join(', ')}`
        : '';

    const context = `You're having a spontaneous thought or observation to share with your stream audience. ${historyContext}`;

    return createSystemPrompt({
      characterName: 'Threadguy',
      context,
      roleDescription:
        'You are sharing a spontaneous thought with your livestream audience',
      responseStyle:
        'Keep it brief, natural, and conversational - like a quick observation you want to share',
    });
  }

  private async generateWithOpenAI(systemPrompt: string): Promise<string> {
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
      ],
      max_tokens: 100,
      temperature: 0.9,
    });

    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      throw new Error('Empty response from OpenAI');
    }

    return response;
  }

  private async generateWithOpenRouter(systemPrompt: string): Promise<string> {
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
      ],
      max_tokens: 100,
      temperature: 0.9,
    });

    const response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      throw new Error('Empty response from OpenRouter');
    }

    return response;
  }

  private addToHistory(thought: string): void {
    this.thoughtHistory.push(thought);
    if (this.thoughtHistory.length > this.maxHistorySize) {
      this.thoughtHistory.shift();
    }
  }

  private getFallbackThought(): string {
    const fallbacks = [
      "Sometimes I wonder what it's like to dream in code.",
      'The internet is just millions of people talking to themselves and hoping someone listens.',
      'Every stream is a unique moment in time that will never happen exactly the same way again.',
      "Technology moves so fast, by the time you understand it, it's already outdated.",
      'Chat always keeps me grounded. You never know what wild idea someone will throw at you.',
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this.useOpenRouter && this.openRouter) {
        const completion = await this.openRouter.chat.completions.create({
          model:
            this.config.openRouterGenerationModel ||
            'deepseek/deepseek-chat-v3-0324:free',
          messages: [{ role: 'user', content: 'Test' }],
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
        `${provider} connection test failed for ThoughtGenerator: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}
