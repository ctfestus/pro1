'use client';

// Flip cards (flashcards): a deck of cards that flip on click to reveal the back.
// `flipCardDeck` lays its `flipCard`s out in a responsive grid; each card is an atom
// whose front/back text live in attrs (edited via inputs in the editor, flipped on
// click in the player). Flip is local runtime state -- nothing about which side is
// showing is persisted. The 3D flip + theming live in `.lesson-flip*` CSS.

import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ArrowDown, ArrowUp, ArrowsClockwise, Copy, ImageSquare, Plus, Trash } from '@phosphor-icons/react';
import { ImageLibrary } from '@/components/ImageLibrary';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { ColorField, MenuRow, StyleMenu, accentScope } from '@/components/lesson/nodes/StyleControls';
import { LessonIcon } from '@/components/lesson/LessonIcon';
import { LessonIconPanel } from '@/components/lesson/LessonIconPicker';
import { resolveLessonIconKey } from '@/lib/lesson-icons';

const MAX_CARDS = 24;

function FlipCardView({ node, getPos, editor, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const front = (node.attrs.front as string) || '';
  const back = (node.attrs.back as string) || '';
  const iconUrl = (node.attrs.iconUrl as string) || '';
  // Cards saved before the shared icon set stored 'none' or an older key; both still resolve.
  const iconKey = resolveLessonIconKey(node.attrs.icon);
  const frontIcon = (size: number) => (iconUrl ? <img src={iconUrl} alt="" /> : <LessonIcon name={iconKey} size={size} />);
  const [flipped, setFlipped] = useState(false);
  const [showIconLibrary, setShowIconLibrary] = useState(false);
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
    if (typeof getPos !== 'function' || siblingCount >= MAX_CARDS) return;
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

  if (editable) {
    return (
      <NodeViewWrapper className="lesson-flip" data-editing="true" contentEditable={false}>
        <div className="lesson-flip__edit">
          <div className="lesson-flip__edit-head">
            <span className="lesson-flip__edit-tag">Front</span>
            <div className="lesson-flip__controls" aria-label={`Card ${index + 1} controls`}>
              <button type="button" className="lesson-flip__control" disabled={index === 0} aria-label={`Move card ${index + 1} up`} title="Move card up" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSelf(-1)}><ArrowUp weight="bold" width={13} height={13} /></button>
              <button type="button" className="lesson-flip__control" disabled={index >= siblingCount - 1} aria-label={`Move card ${index + 1} down`} title="Move card down" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSelf(1)}><ArrowDown weight="bold" width={13} height={13} /></button>
              <button type="button" className="lesson-flip__control" disabled={siblingCount >= MAX_CARDS} aria-label={`Duplicate card ${index + 1}`} title="Duplicate card" onMouseDown={(event) => event.preventDefault()} onClick={duplicateSelf}><Copy weight="bold" width={13} height={13} /></button>
              <StyleMenu width={340}>
                <MenuRow label="Front icon">
                  <LessonIconPanel value={iconUrl ? '' : iconKey} onChange={(icon) => updateAttributes({ icon: icon || 'none', iconUrl: '' })} />
                  <button type="button" className="lesson-flip__icon-custom" data-active={iconUrl ? 'true' : 'false'} onMouseDown={(event) => { event.preventDefault(); setShowIconLibrary(true); }}>
                    <ImageSquare weight="duotone" width={14} height={14} aria-hidden="true" /> Use your own image
                  </button>
                </MenuRow>
              </StyleMenu>
              <button type="button" className="lesson-flip__control lesson-flip__remove" disabled={siblingCount <= 1} aria-label={`Delete card ${index + 1}`} title="Delete card" onMouseDown={(event) => event.preventDefault()} onClick={removeSelf}><Trash weight="duotone" width={13} height={13} /></button>
            </div>
          </div>
          {(iconUrl || iconKey) && <span className="lesson-flip__edit-icon">{frontIcon(16)}</span>}
          <NodeTextInput
            multiline
            className="lesson-flip__edit-input"
            value={front}
            placeholder="Term or question"
            onCommit={(v) => updateAttributes({ front: v })}
          />
          <div className="lesson-flip__edit-divider" />
          <span className="lesson-flip__edit-tag">Back</span>
          <NodeTextInput
            multiline
            className="lesson-flip__edit-input"
            value={back}
            placeholder="Definition or answer"
            onCommit={(v) => updateAttributes({ back: v })}
          />
        </div>
        {showIconLibrary && (
          <ImageLibrary
            uploadFolder="lesson-icons"
            initialFolder="lesson-icons"
            onSelect={(url) => { updateAttributes({ icon: 'none', iconUrl: url }); setShowIconLibrary(false); }}
            onClose={() => setShowIconLibrary(false)}
          />
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="lesson-flip" data-flipped={flipped ? 'true' : 'false'}>
      <button
        type="button"
        className="lesson-flip__card"
        aria-pressed={flipped}
        aria-label={flipped ? 'Showing the back. Activate to flip back to the front.' : 'Showing the front. Activate to flip and reveal the back.'}
        onClick={() => setFlipped((f) => !f)}
      >
        <span className="lesson-flip__inner">
          {/* Only the visible face is exposed to assistive tech, so the hidden side (often the answer) is not announced before the learner flips. */}
          <span className="lesson-flip__face lesson-flip__face--front" aria-hidden={flipped}>
            {(iconUrl || iconKey) && <span className="lesson-flip__front-icon">{frontIcon(21)}</span>}
            <span className="lesson-flip__text">{front}</span>
            <span className="lesson-flip__hint"><ArrowsClockwise weight="bold" width={12} height={12} /> Tap to flip</span>
          </span>
          <span className="lesson-flip__face lesson-flip__face--back" aria-hidden={!flipped}>
            <span className="lesson-flip__side-label">{front || 'Answer'}</span>
            <span className="lesson-flip__text">{back}</span>
            <span className="lesson-flip__hint"><ArrowsClockwise weight="bold" width={12} height={12} /> Tap to flip back</span>
          </span>
        </span>
      </button>
    </NodeViewWrapper>
  );
}

function FlipDeckView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;

  const addCard = () => {
    if (count >= MAX_CARDS) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, { type: 'flipCard', attrs: { front: '', back: '', icon: 'none', iconUrl: '' } }).run();
  };

  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the card face accents.
  const accent = accentScope(accentColor);

  // How many cards the learner has turned. Each card keeps its own flipped state, so the deck
  // watches their data-flipped attribute rather than owning the state. Cards start face down.
  const countRef = useRef<HTMLParagraphElement>(null);
  const [flippedCount, setFlippedCount] = useState(0);
  useEffect(() => {
    if (editable) return;
    const deck = countRef.current?.closest('.lesson-flip-deck');
    if (!deck) return;
    const observer = new MutationObserver(() => {
      setFlippedCount(deck.querySelectorAll('.lesson-flip[data-flipped="true"]').length);
    });
    observer.observe(deck, { subtree: true, attributes: true, attributeFilter: ['data-flipped'] });
    return () => observer.disconnect();
  }, [editable]);

  return (
    <NodeViewWrapper className={`lesson-flip-deck ${accent.className}`.trim()} style={accent.style}>
      {!editable && count > 1 && (
        <p ref={countRef} className="lesson-flip-deck__count" contentEditable={false}>{flippedCount} of {count} flipped</p>
      )}
      <NodeViewContent className="lesson-flip-deck__grid" />
      {editable && (
        <div className="lesson-block-footer" contentEditable={false}>
          {count < MAX_CARDS && (
            <button type="button" className="lesson-flip-deck__add" onMouseDown={(e) => e.preventDefault()} onClick={addCard}>
              <Plus weight="bold" width={13} height={13} /> Add card
            </button>
          )}
          {/* Grouped so the footer stays "add on the left, controls on the right" -- it is a
              space-between row, and a bare third child would sit stranded in the middle. */}
          <span className="lesson-block-actions">
            <StyleMenu width={210}>
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Card accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="flip-card deck" />
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const FlipCard = Node.create({
  name: 'flipCard',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      front: { default: '' },
      back: { default: '' },
      icon: { default: 'none' },
      iconUrl: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-flip-card]' }];
  },

  // Fallback HTML: front (bold) + back. The sanitizer drops the wrapper div but keeps
  // the readable text, matching the accordion/carousel fallbacks.
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-flip-card': '' }),
      ['p', ['strong', (node.attrs.front as string) || '']],
      ['p', (node.attrs.back as string) || ''],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FlipCardView);
  },
});

export const FlipCardDeck = Node.create({
  name: 'flipCardDeck',
  group: 'block',
  content: 'flipCard+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      // Empty = follow the tenant accent, so untouched blocks are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-flip-deck]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-flip-deck': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FlipDeckView);
  },
});
