'use client';

// Timeline: a vertical sequence of dated milestones.
//
// `timeline` holds `timelineEntry`s, each with a date/label, a title, and a rich body.
// Rendered as a vertical connector line with dots; all entries are always visible (it
// is a layout element, not a progressive reveal -- that is what the stepper is for).
// Add/remove entries in the editor. Theming via `.lesson-timeline*` CSS.

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, StyleMenu, MenuRow, accentScope } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';

const MAX_ENTRIES = 30;

function TimelineEntryView({ node, getPos, editor, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const date = (node.attrs.date as string) || '';
  const title = (node.attrs.title as string) || '';
  const { index, siblingCount } = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (typeof getPos !== 'function') return { index: 0, siblingCount: 0 };
      try {
        const pos = getPos();
        if (pos == null) return { index: 0, siblingCount: 0 };
        const resolved = currentEditor.state.doc.resolve(pos);
        return { index: resolved.index(), siblingCount: resolved.parent.childCount };
      } catch {
        return { index: 0, siblingCount: 0 };
      }
    },
  });

  const removeSelf = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  const duplicateSelf = () => {
    if (typeof getPos !== 'function' || siblingCount >= MAX_ENTRIES) return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
  };

  const moveSelf = (direction: -1 | 1) => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    const resolved = editor.state.doc.resolve(pos);
    const currentIndex = resolved.index();
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= resolved.parent.childCount) return;
    const sibling = resolved.parent.child(targetIndex);
    const insertAt = direction < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
    editor.chain().focus().command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize).insert(insertAt, node);
      return true;
    }).run();
  };

  // The last entry hides its connector line, handled purely in CSS via the wrapper's
  // :last-child (see LessonContentStyles). Deriving "lastness" in React here would go
  // stale: adding/removing a sibling does not necessarily re-render this node view.
  return (
    <NodeViewWrapper className="lesson-timeline__entry">
      <div className="lesson-timeline__date-col" contentEditable={false}>
        {editable ? (
          <NodeTextInput className="lesson-timeline__date-input" value={date} placeholder="Date / label" onCommit={(v) => updateAttributes({ date: v })} />
        ) : date ? (
          <span className="lesson-timeline__date">{date}</span>
        ) : null}
      </div>
      <div className="lesson-timeline__dot" contentEditable={false} />
      <div className="lesson-timeline__content">
        <div className="lesson-timeline__meta" contentEditable={false}>
          {editable ? (
            <NodeTextInput className="lesson-timeline__title-input" value={title} placeholder="Title" onCommit={(v) => updateAttributes({ title: v })} />
          ) : title ? (
            <span className="lesson-timeline__title">{title}</span>
          ) : null}
          {editable && (
            <div className="lesson-timeline__controls" aria-label={`Event ${index + 1} controls`}>
              <button type="button" className="lesson-timeline__control" disabled={index === 0} aria-label={`Move event ${index + 1} up`} title="Move event up" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSelf(-1)}><ArrowUp width={13} height={13} /></button>
              <button type="button" className="lesson-timeline__control" disabled={index >= siblingCount - 1} aria-label={`Move event ${index + 1} down`} title="Move event down" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSelf(1)}><ArrowDown width={13} height={13} /></button>
              <button type="button" className="lesson-timeline__control" disabled={siblingCount >= MAX_ENTRIES} aria-label={`Duplicate event ${index + 1}`} title="Duplicate event" onMouseDown={(event) => event.preventDefault()} onClick={duplicateSelf}><Copy width={13} height={13} /></button>
              <button type="button" className="lesson-timeline__control lesson-timeline__remove" disabled={siblingCount <= 1} aria-label={`Delete event ${index + 1}`} title="Delete event" onMouseDown={(event) => event.preventDefault()} onClick={removeSelf}><Trash2 width={13} height={13} /></button>
            </div>
          )}
        </div>
        <NodeViewContent className="lesson-timeline__body" />
      </div>
    </NodeViewWrapper>
  );
}

function TimelineView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;
  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the connector rail, the milestone dots, and the date chips.
  const accent = accentScope(accentColor);

  const addEntry = () => {
    if (count >= MAX_ENTRIES) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, { type: 'timelineEntry', attrs: { date: '', title: '' }, content: [{ type: 'paragraph' }] }).run();
  };

  return (
    <NodeViewWrapper className={`lesson-timeline ${accent.className}`.trim()} style={accent.style}>
      <NodeViewContent className="lesson-timeline__entries" />
      {editable && (
        <div className="lesson-block-footer" contentEditable={false}>
          {count < MAX_ENTRIES && (
            <button type="button" className="lesson-timeline__add" onMouseDown={(e) => e.preventDefault()} onClick={addEntry}>
              <Plus width={13} height={13} /> Add event
            </button>
          )}
          {/* Grouped so the footer stays "add on the left, controls on the right" -- it is a
              space-between row, and a bare third child would sit stranded in the middle. */}
          <span className="lesson-block-actions">
            <StyleMenu width={210}>
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Timeline accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="timeline" />
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const TimelineEntry = Node.create({
  name: 'timelineEntry',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      date: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-date') || '',
        renderHTML: (attrs) => ({ 'data-date': attrs.date }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-timeline-entry]' }];
  },

  // Fallback HTML: date + title on a bold line, then body.
  renderHTML({ node, HTMLAttributes }) {
    const date = (node.attrs.date as string) || '';
    const title = (node.attrs.title as string) || '';
    const heading = [date, title].filter(Boolean).join(' - ');
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-timeline-entry': '' }),
      ...(heading ? [['p', ['strong', heading]]] : []),
      ['div', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimelineEntryView);
  },
});

export const Timeline = Node.create({
  name: 'timeline',
  group: 'block',
  content: 'timelineEntry+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      // Empty = follow the tenant accent, so untouched timelines are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-timeline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-timeline': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimelineView);
  },
});
