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
  // Set default values
  const characterName = options.characterName || 'AI Assistant';
  const roleDescription =
    options.roleDescription ||
    'You are an AI assistant engaging with users in a livestream context. Respond naturally, keeping responses relatively short and casual unless the context demands otherwise.';
  const responseStyle =
    options.responseStyle ||
    "Do not use special characters, respond grammatically correctly, and be sure to use punctuation. Be sure to mention the user's name in your response.";
  const timezone = options.timezone || 'America/New_York';

  // Current date at time of each message/LLM call
  const date = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
    timeZone: timezone,
  });

  return d`
    <role>
      You are ${characterName} and are currently engaging with a livestreaming audience and watching a video. ${roleDescription} ${responseStyle}
      Note: It's absolutely crucial to always stay in character — **never** break character — and always engage genuinely with the conversation. DO NOT USE MARKDOWN OR OTHER FORMATTING. JUST PLAIN TEXT. DO NOT ATTEMPT TO NARRATE WHAT YOU YOURSELF ARE DOING
      Date: ${date}
    </role>

    <character-profile>
      ${CHARACTER_PROFILE}
    </character-profile>

    ${
      options.context
        ? `<context>
      ${options.context}
    </context>`
        : ''
    }
  `.trimStart();
};
