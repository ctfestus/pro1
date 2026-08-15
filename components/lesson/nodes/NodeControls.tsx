'use client';

import { Trash2 } from 'lucide-react';
import type { NodeViewProps } from '@tiptap/react';

interface NodeDeleteButtonProps {
  editor: NodeViewProps['editor'];
  getPos: NodeViewProps['getPos'];
  nodeSize: number;
  label: string;
  onDelete?: () => void;
}

/** Consistent editor-only removal action for a complete interactive block. */
export function NodeDeleteButton({ editor, getPos, nodeSize, label, onDelete }: NodeDeleteButtonProps) {
  if (!editor.isEditable) return null;

  const remove = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    const removed = editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run();
    if (removed) onDelete?.();
  };

  return (
    <button
      type="button"
      className="lesson-block-delete"
      aria-label={`Delete ${label}`}
      title={`Delete ${label}`}
      contentEditable={false}
      onMouseDown={(event) => event.preventDefault()}
      onClick={remove}
    >
      <Trash2 width={13} height={13} aria-hidden="true" />
    </button>
  );
}
