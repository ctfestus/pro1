import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { insertBlock } from '@/lib/lesson-insert';

export function createStepCardsContent(): JSONContent {
  return {
    type: 'stepCards',
    content: [
      { type: 'stepCard', attrs: { title: '', highlightTitle: '', highlightBody: '' }, content: [{ type: 'paragraph' }] },
      { type: 'stepCard', attrs: { title: '', highlightTitle: '', highlightBody: '' }, content: [{ type: 'paragraph' }] },
    ],
  };
}

/** Insert at the caret when possible, otherwise append at the document boundary. */
export function insertStepCards(editor: Editor): boolean {
  return insertBlock(editor, createStepCardsContent());
}
