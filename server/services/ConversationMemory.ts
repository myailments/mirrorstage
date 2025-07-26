import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OpenAI } from 'openai';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';

export type InteractionType =
  | 'user_message'
  | 'bot_response'
  | 'thought'
  | 'vision_observation';

export interface ConversationEntry {
  id: string;
  timestamp: number;
  type: InteractionType;
  userId?: string;
  content: string;
  metadata?: {
    topics?: string[];
    sentiment?: string;
    responseTime?: number;
    model?: string;
    [key: string]: any;
  };
}

export interface ConversationContext {
  entries: ConversationEntry[];
  summary?: string;
  topicFrequency: Map<string, number>;
  lastTopicMentions: Map<string, number>;
}

export interface ConversationAnalytics {
  recentTopics: string[];
  overusedPhrases: string[];
  conversationFlow: string;
  suggestions: string[];
  repetitionScore: number;
}

export class ConversationMemory extends EventEmitter {
  private conversations: Map<string, ConversationEntry[]> = new Map();
  private globalHistory: ConversationEntry[] = [];
  private readonly maxHistorySize: number;
  private readonly maxConversationSize: number;
  private readonly dataDir: string;
  private readonly persistenceFile: string;
  private phraseFrequency: Map<string, number> = new Map();
  private openai?: OpenAI;
  private openRouter?: OpenAI;
  private config?: Config;

  constructor(
    maxHistorySize = 1000,
    maxConversationSize = 100,
    dataDir = './data',
    config?: Config
  ) {
    super();
    this.maxHistorySize = maxHistorySize;
    this.maxConversationSize = maxConversationSize;
    this.dataDir = dataDir;
    this.persistenceFile = path.join(dataDir, 'conversation-memory.json');
    this.config = config;

    // Initialize LLM clients if config provided
    if (config) {
      if (config.useOpenRouter) {
        this.openRouter = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: config.openRouterApiKey,
          defaultHeaders: {
            'HTTP-Referer': config.openRouterSiteUrl || '',
            'X-Title': config.openRouterSiteName || '',
          },
        });
      } else {
        this.openai = new OpenAI({
          apiKey: config.openaiApiKey,
        });
      }
    }

    this.loadMemory().catch((err) =>
      logger.error(`Failed to load conversation memory: ${err}`)
    );
  }

  private async loadMemory(): Promise<void> {
    try {
      const data = await fs.readFile(this.persistenceFile, 'utf-8');
      const loaded = JSON.parse(data);
      this.globalHistory = loaded.globalHistory || [];

      // Rebuild frequency maps
      this.rebuildFrequencyMaps();

      logger.info(`Loaded ${this.globalHistory.length} conversation entries`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        logger.error(`Error loading conversation memory: ${error}`);
      }
    }
  }

  private async saveMemory(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.writeFile(
        this.persistenceFile,
        JSON.stringify(
          {
            globalHistory: this.globalHistory.slice(-this.maxHistorySize),
            savedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (error) {
      logger.error(`Error saving conversation memory: ${error}`);
    }
  }

  private async extractTopics(content: string): Promise<string[]> {
    // If no LLM configured, return empty array
    if (!(this.openai || this.openRouter)) {
      return [];
    }

    try {
      const prompt = `Extract 3-5 key topics or concepts from this text. Return only a comma-separated list of topics, nothing else:\n\n"${content}"`;

      let response: string;

      if (this.config?.useOpenRouter && this.openRouter) {
        const completion = await this.openRouter.chat.completions.create({
          model: 'deepseek/deepseek-chat-v3-0324:free', // Fast and cheap
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 50,
          temperature: 0.3,
        });
        response = completion.choices[0]?.message?.content?.trim() || '';
      } else if (this.openai) {
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 50,
          temperature: 0.3,
        });
        response = completion.choices[0]?.message?.content?.trim() || '';
      } else {
        return [];
      }

      // Parse the comma-separated list
      const topics = response
        .split(',')
        .map((topic) => topic.trim().toLowerCase())
        .filter((topic) => topic.length > 0);

      return topics;
    } catch (error) {
      logger.error(`Failed to extract topics: ${error}`);
      return [];
    }
  }

  private extractPhrases(content: string): string[] {
    // Extract 2-4 word phrases that might be repeated
    const words = content.toLowerCase().split(/\s+/);
    const phrases: string[] = [];

    for (let i = 0; i < words.length - 1; i++) {
      // 2-word phrases
      if (i < words.length - 1) {
        phrases.push(`${words[i]} ${words[i + 1]}`);
      }
      // 3-word phrases
      if (i < words.length - 2) {
        phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      }
    }

    return phrases;
  }

  private updatePhraseFrequency(content: string): void {
    const phrases = this.extractPhrases(content);
    phrases.forEach((phrase) => {
      this.phraseFrequency.set(
        phrase,
        (this.phraseFrequency.get(phrase) || 0) + 1
      );
    });

    // Decay old phrases
    if (this.phraseFrequency.size > 500) {
      const sortedPhrases = Array.from(this.phraseFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 300);
      this.phraseFrequency = new Map(sortedPhrases);
    }
  }

  private rebuildFrequencyMaps(): void {
    this.phraseFrequency.clear();
    this.globalHistory.slice(-200).forEach((entry) => {
      this.updatePhraseFrequency(entry.content);
    });
  }

  async addEntry(
    type: InteractionType,
    content: string,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<ConversationEntry> {
    const entry: ConversationEntry = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      type,
      userId,
      content,
      metadata: {
        ...metadata,
        topics: [], // We'll extract topics in background to not block
      },
    };

    // Add to global history
    this.globalHistory.push(entry);
    if (this.globalHistory.length > this.maxHistorySize) {
      this.globalHistory = this.globalHistory.slice(-this.maxHistorySize);
    }

    // Add to user-specific conversation if userId provided
    if (userId) {
      const userConversation = this.conversations.get(userId) || [];
      userConversation.push(entry);
      if (userConversation.length > this.maxConversationSize) {
        userConversation.shift();
      }
      this.conversations.set(userId, userConversation);
    }

    // Update phrase frequency
    this.updatePhraseFrequency(content);

    // Extract topics in background (don't await)
    this.extractTopics(content)
      .then((topics) => {
        if (topics.length > 0) {
          entry.metadata = { ...entry.metadata, topics };
          // logger.info(`Extracted topics for ${type}: ${topics.join(', ')}`);
        }
      })
      .catch((_err) => {
        // Silently fail topic extraction to not spam logs
      });

    // Save periodically
    if (this.globalHistory.length % 10 === 0) {
      await this.saveMemory();
    }

    this.emit('entryAdded', entry);
    return entry;
  }

  getConversationContext(
    lookbackCount = 20,
    userId?: string
  ): ConversationContext {
    let entries: ConversationEntry[];

    if (userId && this.conversations.has(userId)) {
      // Mix user-specific and global history
      const userEntries = this.conversations.get(userId) || [];
      const globalEntries = this.globalHistory.slice(-lookbackCount);

      // Merge and sort by timestamp
      entries = [...userEntries.slice(-10), ...globalEntries]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-lookbackCount);
    } else {
      entries = this.globalHistory.slice(-lookbackCount);
    }

    // Calculate topic frequency
    const topicFrequency = new Map<string, number>();
    const lastTopicMentions = new Map<string, number>();

    entries.forEach((entry) => {
      if (entry.metadata?.topics) {
        entry.metadata.topics.forEach((topic) => {
          topicFrequency.set(topic, (topicFrequency.get(topic) || 0) + 1);
          lastTopicMentions.set(topic, entry.timestamp);
        });
      }
    });

    return {
      entries,
      topicFrequency,
      lastTopicMentions,
    };
  }

  analyzeConversation(lookbackCount = 30): ConversationAnalytics {
    const context = this.getConversationContext(lookbackCount);
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    // Find recent topics
    const recentTopics = Array.from(context.lastTopicMentions.entries())
      .filter(([_, timestamp]) => timestamp > fiveMinutesAgo)
      .map(([topic]) => topic);

    // Find overused phrases
    const overusedPhrases = Array.from(this.phraseFrequency.entries())
      .filter(([_, count]) => count > 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase]) => phrase);

    // Analyze conversation flow
    const recentTypes = context.entries.slice(-10).map((e) => e.type);
    const thoughtCount = recentTypes.filter((t) => t === 'thought').length;
    const responseCount = recentTypes.filter(
      (t) => t === 'bot_response'
    ).length;

    let conversationFlow = 'balanced';
    if (thoughtCount > responseCount * 2) {
      conversationFlow = 'thought-heavy';
    } else if (responseCount > 5 && thoughtCount === 0) {
      conversationFlow = 'response-heavy';
    }

    // Calculate repetition score
    const uniqueTopics = new Set(recentTopics).size;
    const totalTopics = recentTopics.length;
    const repetitionScore =
      totalTopics > 0 ? 1 - uniqueTopics / totalTopics : 0;

    // Generate suggestions
    const suggestions = this.generateSuggestions(
      recentTopics,
      overusedPhrases,
      conversationFlow,
      repetitionScore
    );

    return {
      recentTopics,
      overusedPhrases,
      conversationFlow,
      suggestions,
      repetitionScore,
    };
  }

  private generateSuggestions(
    recentTopics: string[],
    overusedPhrases: string[],
    conversationFlow: string,
    repetitionScore: number
  ): string[] {
    const suggestions: string[] = [];

    if (repetitionScore > 0.5) {
      suggestions.push('Try exploring new topics or perspectives');
    }

    if (overusedPhrases.length > 0) {
      suggestions.push(
        `Avoid these overused phrases: ${overusedPhrases.slice(0, 3).join(', ')}`
      );
    }

    if (conversationFlow === 'thought-heavy') {
      suggestions.push('Engage more directly with user messages');
    } else if (conversationFlow === 'response-heavy') {
      suggestions.push('Share more spontaneous thoughts and observations');
    }

    if (recentTopics.length > 5) {
      const freshTopics = [
        'personal experiences',
        'creative ideas',
        'philosophical questions',
        'technical insights',
        'humor and jokes',
        'current observations',
      ].filter((topic) => !recentTopics.includes(topic));

      if (freshTopics.length > 0) {
        suggestions.push(
          `Consider discussing: ${freshTopics.slice(0, 2).join(' or ')}`
        );
      }
    }

    return suggestions;
  }

  formatContextForPrompt(lookbackCount = 20, userId?: string): string {
    const context = this.getConversationContext(lookbackCount, userId);
    const analytics = this.analyzeConversation(lookbackCount);

    const conversationHistory = context.entries
      .map((entry) => {
        const prefix =
          entry.type === 'user_message'
            ? `User ${entry.userId}:`
            : entry.type === 'bot_response'
              ? 'You:'
              : entry.type === 'thought'
                ? 'Your thought:'
                : 'Observation:';

        return `${prefix} ${entry.content}`;
      })
      .join('\n');

    let contextPrompt = `Recent conversation:\n${conversationHistory}\n\n`;

    if (analytics.suggestions.length > 0) {
      contextPrompt += `Conversation guidance:\n${analytics.suggestions.join('\n')}\n\n`;
    }

    if (analytics.overusedPhrases.length > 0) {
      contextPrompt += `Avoid repeating these phrases: ${analytics.overusedPhrases.join(', ')}\n\n`;
    }

    return contextPrompt;
  }

  getRecentInteractions(
    count = 10,
    type?: InteractionType
  ): ConversationEntry[] {
    const filtered = type
      ? this.globalHistory.filter((entry) => entry.type === type)
      : this.globalHistory;

    return filtered.slice(-count);
  }

  clearUserConversation(userId: string): void {
    this.conversations.delete(userId);
    logger.info(`Cleared conversation history for user ${userId}`);
  }

  async clearAllMemory(): Promise<void> {
    this.conversations.clear();
    this.globalHistory = [];
    this.phraseFrequency.clear();
    await this.saveMemory();
    this.emit('memoryCleared');
    logger.info('Cleared all conversation memory');
  }
}
