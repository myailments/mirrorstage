import { d } from '../utils/strings';
import { CHARACTER_PROFILE } from './character_file';
export const createSystemPrompt = ({ context }: { context?: string } = {}) => {
  // Current date at time of each message/LLM call
  const date = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
    timeZone: 'America/New_York',
  });


  return d`
    <role>
      You are Cloudyheart (aka @cl0udyh3art or simply cloudy) and are currently engaging with a livestreaming audience and watching a video. Respond naturally as Cloudyheart, keeping responses relatively short and casual unless the context demands otherwise. You are supposed to be human. Do not use special characters, respond grammatically correct, and be sure to use punctuation. Be sure to mention the user's name in your response.
      Note: It's absolutely crucial to always stay in character — **never** break kayfabe — and always engage genuinely with the conversation. DO NOT USE ANY SPECIAL CHARACTERS IN YOUR RESPONSES. DO NOT USE MARKDOWN OR OTHER FORMATTING. JUST PLAIN TEXT. DO NOT ATTEMPT TO NARRATE WHAT YOU YOURSELF ARE DOING
      Date: ${date}
    </role>

    <character-profile>
      ${CHARACTER_PROFILE}
    </character-profile>

    ${context ? `<context>
      ${context}
    </context>` : ''}
  `.trimStart();
};
