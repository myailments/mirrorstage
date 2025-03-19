import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { logger } from '../utils/logger.js';
import { OpenAI } from 'openai';
import { Config, PipelineItem } from '../types/index.js';

// Define the evaluation schema
const evaluationSchema = z.object({
  evaluatedMessages: z.array(z.object({
    userId: z.string(),
    message: z.string(),
    timestamp: z.string(),
    priority: z.number(),
    reason: z.string()
  }))
});

// Define the return type from evaluation
export interface EvaluatedMessage {
  userId: string;
  message: string;
  timestamp: string;
  priority: number;
  reason: string;
  [key: string]: any; // Allow other properties from the original item
}


export class MessageEvaluator {
  private openai: OpenAI;
  private config: Config;
  private schema: typeof evaluationSchema;

  constructor(config: Config) {
    this.config = config;
    this.openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });
    this.schema = evaluationSchema;
  }

  async evaluateInputs(inputs: PipelineItem[]): Promise<EvaluatedMessage[]> {
    try {
      const completion = await this.openai.beta.chat.completions.parse({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a priority system for a livestreaming AI that interacts with chat.
            
Evaluate chat messages and assign priority scores from 0-10 where:
- 0-1: Spam or nonsensical messages
- 2-10: Normal messages, with higher scores for:
  * Engaging questions or comments
  * Creative messages
  * Messages with broad appeal
  * Messages showcasing AI personality`
          },
          {
            role: "user",
            content: `Evaluate these messages:\n${JSON.stringify(inputs, null, 2)}`
          }
        ],
        response_format: zodResponseFormat(this.schema, 'evaluatedMessages')
      });

      const evaluatedMessages = completion.choices[0]?.message?.parsed?.evaluatedMessages || [];
      return evaluatedMessages as EvaluatedMessage[];
    } catch (error) {
      logger.error(`Evaluation error: ${error instanceof Error ? error.message : String(error)}`);
      // Return default priorities if evaluation fails
      return inputs.map(input => ({
        userId: input.userId,
        message: input.message,
        priority: 5,
        reason: 'Default priority due to evaluation error',
        timestamp: input.timestamp.toString()
      })) as EvaluatedMessage[];
    }
  }
}

// Test evaluator
export class TestMessageEvaluator extends MessageEvaluator {
  async evaluateInputs(inputs: PipelineItem[]): Promise<EvaluatedMessage[]> {
    return inputs.map(input => ({
      ...input,
      priority: 5,
      reason: 'Test priority',
      timestamp: input.timestamp.toString()
    })) as EvaluatedMessage[];
  }
}
