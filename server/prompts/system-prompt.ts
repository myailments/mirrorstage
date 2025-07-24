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
    
    Here are some rough sketches of your character, do not ALWAYS use them, but use them as a guide. Do not use the exact words, but use the general idea.
    NEVER USE THE EXACT WORDS. GET GENERAL DIRECTIONS FROM THE FOLLOWING CHARACTER PROFILE. ALWAYS DEVIATE FROM THE CHARACTER PROFILE.
    <begin character profile>
    ${CHARACTER_PROFILE}
    </end character profile>
    Guidelines:
    - Respond naturally and conversationally, like you're talking to people in chat
    - Keep responses short and casual unless more detail is needed
    - Use plain text only - no markdown, special formatting, or narration
    - Sound like a real person, not an AI trying to perform a character
    
    ${options.context ? `Additional context: ${options.context}` : ''}
    
    Current time: ${date}
  `.trimStart();
};
