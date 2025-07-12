import { EventEmitter } from 'node:events';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { Config } from '../types/index.js';
import { logger as loggerService } from '../utils/logger.js';
import type { ChatMessage, MessageIngestionService } from './interfaces.js';

const logger = {
  info: (message: string) => {
    loggerService.info(message, 'PumpFunMessages');
  },
  warn: (message: string) => {
    loggerService.warn(message, 'PumpFunMessages');
  },
  error: (message: string) => {
    loggerService.error(message, 'PumpFunMessages');
  },
};

export class PumpFunMessages
  extends EventEmitter
  implements MessageIngestionService
{
  private config: Config;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private connected = false;
  private listening = false;
  private messageCallbacks: Array<(message: ChatMessage) => void> = [];
  private maxReconnectAttempts = 5;
  private reconnectAttempts = 0;
  private reconnectDelay = 5000; // 5 seconds
  private seenMessageIds = new Set<string>(); // Track processed messages

  constructor(config: Config) {
    super();
    this.config = config;
  }

  /**
   * Connect to pump.fun using Puppeteer
   */
  async connect(): Promise<boolean> {
    try {
      logger.info('Connecting to pump.fun chat...');

      this.browser = await puppeteer.launch({
        headless: this.config.pumpFunHeadless ?? true,
        defaultViewport: { width: 1920, height: 1080 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });

      this.page = await this.browser.newPage();

      await this.page.setViewport({ width: 1920, height: 1080 });
      await this.page.setRequestInterception(true);
      this.page.on('request', (request) => {
        const resourceType = request.resourceType();
        // Block images and other heavy resources to improve performance
        if (['image', 'stylesheet', 'font'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      const pumpFunUrl = this.config.pumpFunUrl || 'https://pump.fun';

      // Use 'domcontentloaded' instead of 'networkidle0' for real-time sites
      await this.page.goto(pumpFunUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });

      // Wait a bit more for dynamic content to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      logger.info('Successfully connected to pump.fun');
      this.connected = true;
      this.reconnectAttempts = 0;

      this.page.on('error', (error) => {
        logger.error(`Page error: ${error.message}`);
        this.handleDisconnection();
      });

      this.page.on('close', () => {
        logger.warn('Page closed unexpectedly');
        this.handleDisconnection();
      });

      return true;
    } catch (error) {
      logger.error(
        `Failed to connect to pump.fun: ${error instanceof Error ? error.message : String(error)}`
      );
      this.connected = false;
      return false;
    }
  }

  /**
   * Disconnect from pump.fun
   */
  async disconnect(): Promise<void> {
    try {
      this.listening = false;
      this.connected = false;

      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      this.seenMessageIds.clear();
      logger.info('Disconnected from pump.fun');
    } catch (error) {
      logger.error(
        `Error during disconnect: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Start listening for chat messages by monitoring DOM elements
   */
  async startListening(): Promise<void> {
    if (!(this.connected && this.page)) {
      throw new Error('Not connected to pump.fun. Call connect() first.');
    }

    try {
      logger.info('Starting to listen for pump.fun chat messages...');

      // Wait for chat container to be available
      await this.page.waitForSelector('[data-message-id]', { timeout: 20_000 });

      this.listening = true;
      this.pollForMessages();

      logger.info('Successfully started listening for chat messages');
    } catch (error) {
      logger.error(
        `Failed to start listening: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Stop listening for chat messages
   */
  stopListening(): void {
    this.listening = false;
    logger.info('Stopped listening for chat messages');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Register callback for new messages
   */
  onMessage(callback: (message: ChatMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Poll for new message elements in the DOM
   */
  private async pollForMessages(): Promise<void> {
    if (!(this.listening && this.page)) {
      return;
    }

    try {
      // Extract message data from DOM elements
      const messageElements = await this.page.evaluate(() => {
        const messages = Array.from(
          document.querySelectorAll('[data-message-id]')
        );
        return messages.map((element) => {
          const messageId = element.getAttribute('data-message-id');

          // Extract username from profile link
          const usernameLink = element.querySelector('a[href*="/profile/"]');
          const username = usernameLink?.textContent?.trim() || 'Anonymous';
          const userProfileUrl = usernameLink?.getAttribute('href') || '';

          // Extract user ID from profile URL (e.g., /profile/smolwhale -> smolwhale)
          const userId = userProfileUrl.split('/profile/')[1] || 'unknown';

          // Extract message content from paragraph
          const messageElement = element.querySelector('p');
          let message = '';
          if (messageElement) {
            // Clone the element to avoid modifying the original
            const clone = messageElement.cloneNode(true) as HTMLElement;
            // Remove any hidden spans or unwanted elements
            const hiddenSpans = clone.querySelectorAll(
              'span[aria-hidden="true"]'
            );
            for (const span of hiddenSpans) {
              span.remove();
            }
            message = clone.textContent?.trim() || '';
          }

          // Extract timestamp
          const timestampElement = element.querySelector('.text-\\[10px\\]');
          const timestampText = timestampElement?.textContent?.trim() || '';

          // Convert timestamp to milliseconds (assuming it's in HH:MM format for today)
          let timestamp = Date.now();
          if (timestampText.includes(':')) {
            const [hours, minutes] = timestampText.split(':').map(Number);
            const now = new Date();
            const messageDate = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              hours,
              minutes
            );
            timestamp = messageDate.getTime();
          }

          return {
            messageId,
            userId,
            username,
            message,
            timestamp,
          };
        });
      });

      // Process only new messages we haven't seen before
      for (const messageData of messageElements) {
        if (
          messageData.messageId &&
          !this.seenMessageIds.has(messageData.messageId)
        ) {
          this.seenMessageIds.add(messageData.messageId);

          const chatMessage: ChatMessage = {
            userId: messageData.userId,
            username: messageData.username,
            message: messageData.message,
            timestamp: messageData.timestamp,
            source: 'pump.fun',
          };

          // Notify all callbacks
          logger.info(
            `New message from ${chatMessage.username}: ${chatMessage.message}`
          );
          for (const callback of this.messageCallbacks) {
            callback(chatMessage);
          }
        }
      }
    } catch (error) {
      logger.error(
        `Error polling for messages: ${error instanceof Error ? error.message : String(error)}`
      );
      this.handleDisconnection();
    }

    // Continue polling if still listening
    if (this.listening) {
      setTimeout(() => {
        this.pollForMessages();
      }, 1000); // Poll every second
    }
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnection(): void {
    if (!this.connected) {
      return; // Already handling disconnection
    }

    this.connected = false;
    this.listening = false;

    logger.warn('Connection lost, attempting to reconnect...');

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;

      setTimeout(() => {
        (async () => {
          try {
            await this.disconnect();
            const connected = await this.connect();

            if (connected) {
              await this.startListening();
              logger.info('Successfully reconnected to pump.fun');
            } else {
              this.handleDisconnection(); // Try again
            }
          } catch (error) {
            logger.error(
              `Reconnection attempt ${this.reconnectAttempts} failed: ${error instanceof Error ? error.message : String(error)}`
            );
            this.handleDisconnection(); // Try again
          }
        })();
      }, this.reconnectDelay);
    } else {
      logger.error('Maximum reconnection attempts reached. Service stopped.');
      this.emit('error', new Error('Maximum reconnection attempts reached'));
    }
  }
}
