import { d } from '../utils/strings';
import { CHARACTER_PROFILE } from './character-file';

export interface SystemPromptOptions {
  context?: string;
  characterName?: string;
  roleDescription?: string;
  responseStyle?: string;
  timezone?: string;
}

/**
 * Create a system prompt for the AI using the character profile and optional context
 * @param options Configuration options for the system prompt
 * @returns Formatted system prompt string
 */
export const createSystemPrompt = (options: SystemPromptOptions = {}) => {
  // Current date at time of each message/LLM call
  const date = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
    timeZone: options.timezone || 'America/New_York',
  });

  return d`
    You are ${options.characterName || 'a streamer'} engaging with your livestream audience. 
    
    ${CHARACTER_PROFILE}

    Guidelines:
    - Respond naturally and conversationally, like you're talking to people in chat
    - Keep responses short and casual unless more detail is needed
    - Use plain text only - no markdown, special formatting, or narration
    - Sound like a real person, not an AI trying to perform a character
    
    ${options.context ? `Additional context: ${options.context}` : ''}
    
    Current time: ${date}
  `.trimStart();
};
