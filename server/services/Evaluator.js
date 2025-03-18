import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { logger } from '../utils/logger.js';

export class MessageEvaluator {
  constructor() {
    this.schema = z.object({
      evaluatedMessages: z.array(z.object({
        userId: z.string(),
        message: z.string(),
        timestamp: z.string(),
        priority: z.number(),
        reason: z.string()
      }))
    });
  }

  async evaluateInputs(inputs) {
    try {
      const completion = await openai.beta.chat.completions.parse({
        model: "gpt-4-turbo-preview",
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

      return completion.choices[0]?.message?.parsed?.evaluatedMessages || [];
    } catch (error) {
      logger.error(`Evaluation error: ${error.message}`);
      // Return default priorities if evaluation fails
      return inputs.map(input => ({
        ...input,
        priority: 5,
        reason: 'Default priority due to evaluation error'
      }));
    }
  }
} 