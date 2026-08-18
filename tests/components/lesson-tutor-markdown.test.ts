import { describe, expect, it } from 'vitest';

import { parseTutorMarkdown } from '@/lib/tutor-markdown';

describe('TutorMarkdown ordered lists', () => {
  it('keeps numbered items separated by blank lines in one ordered list', () => {
    expect(parseTutorMarkdown('1. First item\n\n2. Second item\n\n3. Third item')).toEqual([
      { kind: 'list', ordered: true, items: ['First item', 'Second item', 'Third item'] },
    ]);
  });

  it('lets repeated Markdown 1 markers auto-number within one list', () => {
    expect(parseTutorMarkdown('1. First item\n\n1. Second item\n\n1. Third item')).toEqual([
      { kind: 'list', ordered: true, items: ['First item', 'Second item', 'Third item'] },
    ]);
  });

  it('closes the list when an ordinary paragraph begins', () => {
    expect(parseTutorMarkdown('1. First item\n\n2. Second item\n\nA concluding paragraph.')).toEqual([
      { kind: 'list', ordered: true, items: ['First item', 'Second item'] },
      { kind: 'paragraph', text: 'A concluding paragraph.' },
    ]);
  });
});
