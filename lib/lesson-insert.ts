import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const takesBlocks = (node: ProseMirrorNode, state: EditorState) =>
  node.type.contentMatch.matchType(state.schema.nodes.paragraph) != null;

/**
 * Where a new block should go when the selection is not a spot to type in. Inside a paragraph
 * (or any text block) the answer is null: insert at the caret, as always. Otherwise -- a whole
 * block selected, or an item of a flip-card deck or icon grid, whose parent holds only its own
 * items -- inserting in place would replace that block or split its parent in two. The block goes
 * right after the nearest ancestor that sits in a container taking any block instead.
 */
export function blockInsertPos(state: EditorState): number | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) && selection.$from.parent.isTextblock) return null;
  const $to = selection.$to;
  for (let depth = $to.depth; depth >= 0; depth--) {
    if (!takesBlocks($to.node(depth), state)) continue;
    return depth === $to.depth ? selection.to : $to.after(depth + 1);
  }
  return null;
}

/** Insert a block at the caret, after the current block when that would break it, or at the end. */
export function insertBlock(editor: Editor, content: JSONContent): boolean {
  const at = blockInsertPos(editor.state);
  if (at != null) return editor.chain().focus().insertContentAt(at, content).run();

  const before = editor.state.doc;
  const insertedAtSelection = editor.chain().focus().insertContent(content).run();
  if (insertedAtSelection && !editor.state.doc.eq(before)) return true;

  return editor.chain()
    .focus()
    .insertContentAt(editor.state.doc.content.size, content)
    .run();
}
