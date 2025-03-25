declare module 'to-zalgo' {
    export default function zalgo(text: string, options?: { up?: boolean; middle?: boolean; down?: boolean, size?: 'mini' | 'maxi' }): string;
  }