'use client';

// Numbered instructional cards inspired by workbook-style step layouts. Unlike
// the progressive Stepper, every card remains visible so learners can scan the
// complete process. Each card supports rich body content and an optional guidance
// panel for reminders, checks, or submission notes.

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ArrowDown, ArrowUp, Copy, Plus, X } from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, StyleMenu, MenuRow, accentScope } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';

const MAX_STEP_CARDS = 12;

function StepCardView({ node, getPos, editor, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  // Position is not part of a ProseMirror node's identity, so moving an unchanged
  // node does not update ordinary React node-view props. Subscribe to transactions
  // explicitly so numbering and arrow availability always reflect document order.
  const { index, siblingCount } = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (typeof getPos !== 'function') return { index: 0, siblingCount: 0 };
      try {
        const pos = getPos();
        if (pos == null) return { index: 0, siblingCount: 0 };
        const $pos = currentEditor.state.doc.resolve(pos);
        return { index: $pos.index(), siblingCount: $pos.parent.childCount };
      } catch {
        return { index: 0, siblingCount: 0 };
      }
    },
  });
  const title = (node.attrs.title as string) || '';
  const highlightTitle = (node.attrs.highlightTitle as string) || '';
  const highlightBody = (node.attrs.highlightBody as string) || '';
  const hasHighlight = !!(highlightTitle.trim() || highlightBody.trim());
  const [guidanceOpen, setGuidanceOpen] = useState(hasHighlight);
  const showGuidance = hasHighlight || guidanceOpen;
  const canMoveUp = index > 0;
  const canMoveDown = siblingCount > 0 && index < siblingCount - 1;

  const removeSelf = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  const duplicateSelf = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    const $pos = editor.state.doc.resolve(pos);
    if ($pos.parent.childCount >= MAX_STEP_CARDS) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
  };

  const moveSelf = (direction: -1 | 1) => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    const $pos = editor.state.doc.resolve(pos);
    const currentIndex = $pos.index();
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= $pos.parent.childCount) return;

    const sibling = $pos.parent.child(targetIndex);
    const insertAt = direction < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
    editor.chain().focus().command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize).insert(insertAt, node);
      return true;
    }).run();
  };

  const removeGuidance = () => {
    updateAttributes({ highlightTitle: '', highlightBody: '' });
    setGuidanceOpen(false);
  };

  return (
    <NodeViewWrapper className="lesson-step-card">
      <div className="lesson-step-card__number" contentEditable={false}>{index + 1}</div>
      <div className="lesson-step-card__main">
        <div className="lesson-step-card__header" contentEditable={false}>
          {editable ? (
            <NodeTextInput
              className="lesson-step-card__title-input"
              value={title}
              placeholder="Step title"
              onCommit={(value) => updateAttributes({ title: value })}
            />
          ) : (
            <h3 className="lesson-step-card__title">{title || `Step ${index + 1}`}</h3>
          )}
          {editable && (
            <div className="lesson-step-card__controls">
              <button type="button" className="lesson-step-card__action" aria-label="Move step card up" title="Move up" disabled={!canMoveUp} onMouseDown={(event) => { event.preventDefault(); moveSelf(-1); }}>
                <ArrowUp width={13} height={13} />
              </button>
              <button type="button" className="lesson-step-card__action" aria-label="Move step card down" title="Move down" disabled={!canMoveDown} onMouseDown={(event) => { event.preventDefault(); moveSelf(1); }}>
                <ArrowDown width={13} height={13} />
              </button>
              <button type="button" className="lesson-step-card__action" aria-label="Duplicate step card" title="Duplicate" onMouseDown={(event) => { event.preventDefault(); duplicateSelf(); }}>
                <Copy width={13} height={13} />
              </button>
              <button type="button" className="lesson-step-card__action lesson-step-card__remove" aria-label="Remove step card" title="Remove" onMouseDown={(event) => { event.preventDefault(); removeSelf(); }}>
                <X width={13} height={13} />
              </button>
            </div>
          )}
        </div>

        <NodeViewContent className="lesson-step-card__body" />

        {editable && !showGuidance && (
          <button type="button" className="lesson-step-card__add-guidance" contentEditable={false} onMouseDown={(event) => { event.preventDefault(); setGuidanceOpen(true); }}>
            <Plus width={12} height={12} /> Add guidance
          </button>
        )}

        {(hasHighlight || (editable && showGuidance)) && (
          <div className="lesson-step-card__highlight" contentEditable={false} data-editing={editable ? 'true' : 'false'} data-empty={!hasHighlight ? 'true' : 'false'}>
            {editable ? (
              <>
                <button type="button" className="lesson-step-card__remove-guidance" aria-label="Remove guidance" title="Remove guidance" onMouseDown={(event) => { event.preventDefault(); removeGuidance(); }}>
                  <X width={12} height={12} />
                </button>
                <NodeTextInput
                  className="lesson-step-card__highlight-title-input"
                  value={highlightTitle}
                  placeholder="Optional guidance heading"
                  onCommit={(value) => updateAttributes({ highlightTitle: value })}
                />
                <NodeTextInput
                  multiline
                  className="lesson-step-card__highlight-body-input"
                  value={highlightBody}
                  placeholder="Optional guidance, reminder, or what to look for..."
                  onCommit={(value) => updateAttributes({ highlightBody: value })}
                />
              </>
            ) : (
              <>
                {highlightTitle && <p className="lesson-step-card__highlight-title">{highlightTitle}</p>}
                {highlightBody && <p className="lesson-step-card__highlight-body">{highlightBody}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

function StepCardsView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;
  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the numbered circles and the guidance panel on every card in the set.
  const accent = accentScope(accentColor);

  const addCard = () => {
    if (count >= MAX_STEP_CARDS) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, {
      type: 'stepCard',
      attrs: { title: '', highlightTitle: '', highlightBody: '' },
      content: [{ type: 'paragraph' }],
    }).run();
  };

  return (
    <NodeViewWrapper className={`lesson-step-cards ${accent.className}`.trim()} style={accent.style}>
      <NodeViewContent className="lesson-step-cards__items" />
      {editable && (
        <div className="lesson-block-footer" contentEditable={false}>
          {count < MAX_STEP_CARDS && (
            <button type="button" className="lesson-step-cards__add" onMouseDown={(event) => { event.preventDefault(); addCard(); }}>
              <Plus width={13} height={13} /> Add step card
            </button>
          )}
          {/* Grouped so the footer stays "add on the left, controls on the right" -- it is a
              space-between row, and a bare third child would sit stranded in the middle. */}
          <span className="lesson-block-actions">
            <StyleMenu width={210}>
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Step accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="step cards" />
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const StepCard = Node.create({
  name: 'stepCard',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
      highlightTitle: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-highlight-title') || '',
        renderHTML: () => ({}),
      },
      highlightBody: {
        default: '',
        parseHTML: (element) => element.querySelector('[data-step-card-highlight]')?.textContent || '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-step-card]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || '';
    const highlightTitle = (node.attrs.highlightTitle as string) || '';
    const highlightBody = (node.attrs.highlightBody as string) || '';
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-step-card': '',
        'data-highlight-title': highlightTitle,
      }),
      ...(title ? [['p', ['strong', title]]] : []),
      ['div', 0],
      ...(highlightTitle || highlightBody ? [[
        'blockquote',
        { 'data-step-card-highlight': '' },
        ...(highlightTitle ? [['p', ['strong', highlightTitle]]] : []),
        ...(highlightBody ? [['p', highlightBody]] : []),
      ]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StepCardView);
  },
});

export const StepCards = Node.create({
  name: 'stepCards',
  group: 'block',
  content: 'stepCard+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      // Empty = follow the tenant accent, so untouched step cards are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-step-cards]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-step-cards': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StepCardsView);
  },
});
