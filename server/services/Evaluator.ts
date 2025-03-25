import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { logger } from '../utils/logger.js';
import { OpenAI } from 'openai';
import { Config, PipelineItem } from '../types/index.js';
import axios from 'axios';

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
  private openai?: OpenAI;
  private config: Config;
  private schema: typeof evaluationSchema;
  private useDeepseek: boolean;

  constructor(config: Config) {
    this.config = config;
    this.useDeepseek = config.useDeepseekLocal || false;
    
    if (!this.useDeepseek) {
      this.openai = new OpenAI({
        apiKey: config.openaiApiKey,
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

    const userPrompt = `Evaluate these messages:\n${JSON.stringify(inputs, null, 2)}`;

    try {
      if (this.useDeepseek) {
        return await this.evaluateWithDeepseek(inputs, systemPrompt, userPrompt);
      } else {
        return await this.evaluateWithOpenAI(inputs, systemPrompt, userPrompt);
      }
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

  private async evaluateWithOpenAI(inputs: PipelineItem[], systemPrompt: string, userPrompt: string): Promise<EvaluatedMessage[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const completion = await this.openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      response_format: zodResponseFormat(this.schema, 'evaluatedMessages')
    });

    const evaluatedMessages = completion.choices[0]?.message?.parsed?.evaluatedMessages || [];
    return evaluatedMessages as EvaluatedMessage[];
  }

  private async evaluateWithDeepseek(inputs: PipelineItem[], systemPrompt: string, userPrompt: string): Promise<EvaluatedMessage[]> {
    const endpoint = `http://localhost:${this.config.deepseekPort}${this.config.deepseekEndpoint}/chat/completions`;
    
    try {
      // Since Deepseek may not support the OpenAI zod format directly,
      // we'll use a structured output approach with instructions
      const structuredPrompt = `${systemPrompt}
      
YOUR RESPONSE MUST BE A VALID JSON ARRAY OF OBJECTS with the following structure:
[
  {
    "userId": "user id string",
    "message": "original message string",
    "timestamp": "timestamp as string",
    "priority": number from 0-10,
    "reason": "brief explanation of priority"
  },
  ...
]

Evaluate these messages and return ONLY the JSON array:
${JSON.stringify(inputs, null, 2)}`;

      const response = await axios.post(endpoint, {
        model: "deepseek-coder-v3",
        messages: [
          {
            role: "user",
            content: structuredPrompt
          }
        ],
        max_tokens: 1000
      });

      const content = response.data.choices[0]?.message?.content?.trim();
      
      if (!content) {
        throw new Error('Empty response from Deepseek');
      }
      
      // Extract the JSON array from the response
      // This assumes Deepseek will return a parseable JSON array
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (!jsonMatch) {
        throw new Error('Could not find JSON array in Deepseek response');
      }

      try {
        const parsedResponse = JSON.parse(jsonMatch[0]);
        return parsedResponse.map((item: any) => ({
          userId: item.userId || '',
          message: item.message || '',
          timestamp: item.timestamp || '',
          priority: typeof item.priority === 'number' ? item.priority : 5,
          reason: item.reason || 'No reason provided'
        }));
      } catch (parseError) {
        logger.error(`Failed to parse Deepseek JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        throw parseError;
      }
    } catch (error) {
      logger.error(`Deepseek API error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
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
