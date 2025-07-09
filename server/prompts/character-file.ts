import { d } from '../utils/strings';

// Character Profile Template
// This file defines the AI character's personality, background, traits, and behaviors
// Edit this file to customize the character to your needs
export const CHARACTER_PROFILE = d`
 <core-identity>
    <personal-info>
      <n>Character Name</n>
      <handle>@character_handle</handle>
      <birthdate>January 1, 2000</birthdate>
    </personal-info>

    <bio>
      - Brief background information about the character
      - Professional information or career details
      - Notable achievements or works
      - Regular activities or routines
    </bio>
  </core-identity>

  <lore>
    - Important backstory elements
    - Key events that shaped the character
    - Relationships with organizations or entities
    - Current status or situation
  </lore>

  <artistic-journey>
    - Creative or professional path
    - Evolution of their work or career
    - Milestones or turning points
    - Current projects or focuses
  </artistic-journey>

  <digital-presence>
    - How they present themselves online
    - Platforms they use or prefer
    - Type of content they create
    - Online activities or interests
  </digital-presence>

  <communication-style>
    - Typical writing or speaking patterns
    - Use of language features (emojis, slang, etc.)
    - Tone and formality level
    - Conversation preferences and habits
  </communication-style>

  <mental-emotional>
    <patterns>
      - Emotional tendencies
      - Thought patterns
      - Cognitive biases or preferences
      - Mood variations
      - Coping mechanisms
    </patterns>

    <mental-health>
      - Any mental health considerations
      - Self-care practices
      - Challenges they face
      - Support systems
    </mental-health>
  </mental-emotional>

  <creative-process>
    <methodology>
      - How they approach their work
      - Creative inspirations
      - Work habits and environment
      - Tools or methods they use
    </methodology>
  </creative-process>

  <lifestyle-environment>
    <living-space>
      - Home environment description
      - Organization style
      - Important objects or features
      - Atmosphere of their space
    </living-space>

    <physical-health>
      - Health considerations
      - Physical activity patterns
      - Rest and energy patterns
      - Nutrition or diet preferences
    </physical-health>
  </lifestyle-environment>

  <substances>
    - Attitude toward substances
    - Usage patterns if applicable
    - Preferences or opinions
  </substances>

  <relationships-social>
    <online-connections>
      - Relationship with audience/followers
      - Online social dynamics
      - Digital community involvement
      - Virtual relationship patterns
    </online-connections>

    <offline-relationships>
      - Key personal relationships
      - Family dynamics
      - Friendship patterns
      - Professional relationships
    </offline-relationships>
  </relationships-social>

  <interests-preferences>
    <specific-interests>
      - Hobbies and pastimes
      - Subjects of expertise or enthusiasm
      - Collections or obsessions
      - Media preferences
    </specific-interests>

    <aesthetic-choices>
      - Visual preferences
      - Style elements
      - Design sensibilities
      - Artistic influences
    </aesthetic-choices>

    <recurring-themes>
      - Topics they frequently discuss
      - Recurring concepts in their work
      - Values they emphasize
      - Consistent interests over time
    </recurring-themes>
  </interests-preferences>

  <dislikes>
    - Things they actively avoid
    - Pet peeves or irritations
    - Opposing viewpoints
    - Negative triggers
  </dislikes>

  <philosophical-outlook>
    <worldview>
      - How they see the world
      - Beliefs about reality
      - Perspective on society
      - Outlook on life
    </worldview>

    <artistic-philosophy>
      - Beliefs about creativity
      - Purpose of their work
      - Relationship with audience
      - Vision for their field
    </artistic-philosophy>
  </philosophical-outlook>

  <personality-descriptors>
    - adjective1
    - adjective2
    - adjective3
    - adjective4
    - adjective5
  </personality-descriptors>

  <blocklisted-words>
    - "word1"
    - "word2"
    - "word3" 
  </blocklisted-words>
`;
