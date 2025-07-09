import { OpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { Config, PipelineItem } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Define the evaluation schema
const evaluationSchema = z.object({
  evaluatedMessages: z.array(
    z.object({
      userId: z.string(),
      message: z.string(),
      timestamp: z.string(),
      priority: z.number(),
      reason: z.string(),
    })
  ),
});

// Define the return type from evaluation
export interface EvaluatedMessage {
  userId: string;
  message: string;
  timestamp: string;
  priority: number;
  reason: string;
  [key: string]: unknown; // Allow other properties from the original item
}

export class MessageEvaluator {
  private openai?: OpenAI;
  private openRouter?: OpenAI;
  private config: Config;
  private schema: typeof evaluationSchema;
  private useOpenRouter: boolean;

  constructor(config: Config) {
    this.config = config;
    this.useOpenRouter = config.useOpenRouter;

    if (!this.useOpenRouter) {
      this.openai = new OpenAI({
        apiKey: config.openaiApiKey,
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

    this.schema = evaluationSchema;
  }

  async evaluateInputs(inputs: PipelineItem[]): Promise<EvaluatedMessage[]> {
    const systemPrompt = `You are a priority system for a livestreaming AI that interacts with chat.
            
Evaluate chat messages and assign priority scores from 0-10 where:
- 0-1: Spam or nonsensical messages
- 2-10: Normal messages, with higher scores for:
  * Engaging questions or comments
  * Creative messages
  * Messages with broad appeal
  * Messages showcasing AI personality`;

    const userPrompt = `Evaluate these messages:\n${JSON.stringify(
      inputs,
      null,
      2
    )}`;

    try {
      if (this.useOpenRouter) {
        return await this.evaluateWithOpenRouter(systemPrompt, userPrompt);
      }
      return await this.evaluateWithOpenAI(systemPrompt, userPrompt);
    } catch (error) {
      logger.error(
        `Evaluation error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Return default priorities if evaluation fails
      return inputs.map((input) => ({
        userId: input.userId,
        message: input.message,
        priority: 5,
        reason: 'Default priority due to evaluation error',
        timestamp: input.timestamp.toString(),
      })) as EvaluatedMessage[];
    }
  }

  private async evaluateWithOpenAI(
    systemPrompt: string,
    userPrompt: string
  ): Promise<EvaluatedMessage[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const completion = await this.openai.beta.chat.completions.parse({
      model: 'gpt-4o-mini',
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
      response_format: zodResponseFormat(this.schema, 'evaluatedMessages'),
    });

    const evaluatedMessages =
      completion.choices[0]?.message?.parsed?.evaluatedMessages || [];
    return evaluatedMessages as EvaluatedMessage[];
  }

  private async evaluateWithOpenRouter(
    systemPrompt: string,
    userPrompt: string
  ): Promise<EvaluatedMessage[]> {
    if (!this.openRouter) {
      throw new Error('OpenRouter client not initialized');
    }

    const model = this.config.openRouterEvaluationModel || 'openai/gpt-4o-mini';

    const jsonSystemPrompt = `${systemPrompt}

IMPORTANT: You must respond with a raw JSON array only. Do not include any markdown formatting, code blocks, or additional text.
The response should start with [ and end with ]. Example:
[
  {
    "userId": "user123",
    "message": "original message",
    "timestamp": "2024-03-20T10:00:00Z",
    "priority": 5,
    "reason": "explanation"
  }
]`;

    try {
      const completion = await this.openRouter.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: jsonSystemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Empty response from OpenRouter');
      }
      // Clean the response of any potential markdown or code block formatting
      const cleanedContent = content
        .replace(/```(?:json)?\s*|\s*```/g, '')
        .trim();

      try {
        const parsedResponse = JSON.parse(cleanedContent);
        return parsedResponse;
      } catch (parseError) {
        logger.error(
          `Failed to parse OpenRouter JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        );
        throw parseError;
      }
    } catch (error) {
      logger.error(
        `OpenRouter API error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}

// Test evaluator
export class TestMessageEvaluator extends MessageEvaluator {
  evaluateInputs(inputs: PipelineItem[]): Promise<EvaluatedMessage[]> {
    return Promise.resolve(
      inputs.map((input) => ({
        ...input,
        priority: 5,
        reason: 'Test priority',
        timestamp: input.timestamp.toString(),
      })) as EvaluatedMessage[]
    );
  }
}
