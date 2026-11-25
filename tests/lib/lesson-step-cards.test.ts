import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import { createStepCardsContent, insertStepCards } from '@/lib/lesson-step-cards';

function mockEditor(options: { selectionRun: boolean; selectionChangesDoc: boolean }) {
  let changed = false;
  let operation: 'selection' | 'boundary' = 'selection';
  const insertContentAt = vi.fn(() => {
    operation = 'boundary';
    return chain;
  });
  const chain = {
    focus: () => chain,
    insertContent: () => {
      operation = 'selection';
      return chain;
    },
    insertContentAt,
    run: () => {
      if (operation === 'selection') {
        changed = options.selectionChangesDoc;
        return options.selectionRun;
      }
      changed = true;
      return true;
    },
  };
  const doc = {
    content: { size: 27 },
    eq: () => !changed,
  };
  const editor = {
    // The caret sits in a paragraph, so insertion goes through the selection path.
    state: { doc, selection: { $from: { parent: { isTextblock: true } } } },
    chain: () => chain,
  } as unknown as Editor;

  return { editor, insertContentAt };
}

describe('step cards insertion', () => {
  it('creates two editable cards by default', () => {
    const content = createStepCardsContent();
    expect(content.type).toBe('stepCards');
    expect(content.content).toHaveLength(2);
    expect(content.content?.every((card) => card.type === 'stepCard')).toBe(true);
  });

  it('keeps a successful insertion at the current selection', () => {
    const { editor, insertContentAt } = mockEditor({ selectionRun: true, selectionChangesDoc: true });
    expect(insertStepCards(editor)).toBe(true);
    expect(insertContentAt).not.toHaveBeenCalled();
  });

  it('falls back to the document boundary after a silent selection no-op', () => {
    const { editor, insertContentAt } = mockEditor({ selectionRun: false, selectionChangesDoc: false });
    expect(insertStepCards(editor)).toBe(true);
    expect(insertContentAt).toHaveBeenCalledWith(27, expect.objectContaining({ type: 'stepCards' }));
  });
});
