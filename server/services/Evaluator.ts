import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { logger } from "../utils/logger.js";
import { OpenAI } from "openai";
import { Config, PipelineItem } from "../types/index.js";

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
  [key: string]: any; // Allow other properties from the original item
}

export class MessageEvaluator {
  private openai?: OpenAI;
  private openRouter?: OpenAI;
  private config: Config;
  private schema: typeof evaluationSchema;
  private useDeepseek: boolean;
  private useOpenRouter: boolean;

  constructor(config: Config) {
    this.config = config;
    this.useDeepseek = config.useDeepseekLocal || false;
    this.useOpenRouter = config.useOpenRouter || false;

    if (!this.useDeepseek && !this.useOpenRouter) {
      this.openai = new OpenAI({
        apiKey: config.openaiApiKey,
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
      if (this.useDeepseek) {
        return await this.evaluateWithDeepseek(
          inputs,
          systemPrompt,
          userPrompt
        );
      } else if (this.useOpenRouter) {
        return await this.evaluateWithOpenRouter(
          inputs,
          systemPrompt,
          userPrompt
        );
      } else {
        return await this.evaluateWithOpenAI(inputs, systemPrompt, userPrompt);
      }
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
        reason: "Default priority due to evaluation error",
        timestamp: input.timestamp.toString(),
      })) as EvaluatedMessage[];
    }
  }

  private async evaluateWithOpenAI(
    inputs: PipelineItem[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<EvaluatedMessage[]> {
    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const completion = await this.openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      response_format: zodResponseFormat(this.schema, "evaluatedMessages"),
    });

    const evaluatedMessages =
      completion.choices[0]?.message?.parsed?.evaluatedMessages || [];
    return evaluatedMessages as EvaluatedMessage[];
  }

  private async evaluateWithOpenRouter(
    inputs: PipelineItem[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<EvaluatedMessage[]> {
    if (!this.openRouter) {
      throw new Error("OpenRouter client not initialized");
    }

    const model = this.config.openRouterModel || "deepseek/deepseek-chat-v3-0324:free";

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
        model: model,
        messages: [
          {
            role: "system",
            content: jsonSystemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(inputs, null, 2)
          },
        ],
        max_tokens: 1000,
        response_format: { type: "json_object" }
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("Empty response from OpenRouter");
      }

      // Clean the response of any potential markdown or code block formatting
      const cleanedContent = content.replace(/```(?:json)?\s*|\s*```/g, '').trim();
      
      try {
        const parsedResponse = JSON.parse(cleanedContent);
        return parsedResponse.map((item: any) => ({
          userId: item.userId || "",
          message: item.message || "",
          timestamp: item.timestamp || "",
          priority: typeof item.priority === "number" ? item.priority : 5,
          reason: item.reason || "No reason provided",
        }));
      } catch (parseError) {
        logger.error(`Failed to parse OpenRouter JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        throw parseError;
      }
    } catch (error) {
      logger.error(`OpenRouter API error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async evaluateWithDeepseek(
    inputs: PipelineItem[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<EvaluatedMessage[]> {
    const endpoint = `http://localhost:${this.config.deepseekPort}${this.config.deepseekEndpoint}/chat/completions`;

    const jsonSystemPrompt = `${systemPrompt}

## Response Format

Reply with JSON array ONLY. No other text or markdown formatting.`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-coder-v3",
          messages: [
            {
              role: "system",
              content: jsonSystemPrompt,
            },
            {
              role: "user",
              content: JSON.stringify(inputs, null, 2)
            },
          ],
          max_tokens: 1000,
        }),
      });

      const data = await response.json();
      const content = data.choices[0]?.message?.content?.trim();

      if (!content) {
        throw new Error("Empty response from Deepseek");
      }

      // Parse the raw JSON response
      try {
        const parsedResponse = JSON.parse(content);
        return parsedResponse.map((item: any) => ({
          userId: item.userId || "",
          message: item.message || "",
          timestamp: item.timestamp || "",
          priority: typeof item.priority === "number" ? item.priority : 5,
          reason: item.reason || "No reason provided",
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
    return inputs.map((input) => ({
      ...input,
      priority: 5,
      reason: "Test priority",
      timestamp: input.timestamp.toString(),
    })) as EvaluatedMessage[];
  }
}
