// Video Sync Service interface
export interface VideoSyncService {
  process(audioPath: string): Promise<string>;
  testConnection(): Promise<boolean>;
}

// Message Ingestion Service interface
export interface MessageIngestionService {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): void;
  isConnected(): boolean;
  onMessage(callback: (message: ChatMessage) => void): void;
}

// Chat message interface
export interface ChatMessage {
  userId: string;
  username: string;
  message: string;
  timestamp: number;
  source: string;
}
