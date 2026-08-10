'use client';

// Flip cards (flashcards): a deck of cards that flip on click to reveal the back.
// `flipCardDeck` lays its `flipCard`s out in a responsive grid; each card is an atom
// whose front/back text live in attrs (edited via inputs in the editor, flipped on
// click in the player). Flip is local runtime state -- nothing about which side is
// showing is persisted. The 3D flip + theming live in `.lesson-flip*` CSS.

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ArrowDown, ArrowUp, BookOpen, Brain, CalendarDays, Clock3, Code2, Copy, Globe2, HelpCircle, Image as ImageIcon, Lightbulb, MessageCircle, Plus, Puzzle, RefreshCw, Rocket, ShieldCheck, Sparkles, Target, Trash2, TrendingUp, Users, WandSparkles, X, Zap } from 'lucide-react';
import { ImageLibrary } from '@/components/ImageLibrary';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { MenuRow, StyleMenu } from '@/components/lesson/nodes/StyleControls';

const MAX_CARDS = 24;

type FlipIconName = 'none' | 'sparkles' | 'lightbulb' | 'target' | 'book' | 'brain' | 'question' | 'rocket' | 'zap' | 'globe' | 'users' | 'clock' | 'calendar' | 'message' | 'code' | 'shield' | 'growth' | 'puzzle' | 'magic';

const FLIP_ICONS: Record<Exclude<FlipIconName, 'none'>, { label: string; Icon: typeof Sparkles }> = {
  sparkles: { label: 'Sparkles', Icon: Sparkles },
  lightbulb: { label: 'Idea', Icon: Lightbulb },
  target: { label: 'Target', Icon: Target },
  book: { label: 'Book', Icon: BookOpen },
  brain: { label: 'Brain', Icon: Brain },
  question: { label: 'Question', Icon: HelpCircle },
  rocket: { label: 'Rocket', Icon: Rocket },
  zap: { label: 'Energy', Icon: Zap },
  globe: { label: 'Globe', Icon: Globe2 },
  users: { label: 'People', Icon: Users },
  clock: { label: 'Time', Icon: Clock3 },
  calendar: { label: 'Calendar', Icon: CalendarDays },
  message: { label: 'Message', Icon: MessageCircle },
  code: { label: 'Code', Icon: Code2 },
  shield: { label: 'Shield', Icon: ShieldCheck },
  growth: { label: 'Growth', Icon: TrendingUp },
  puzzle: { label: 'Puzzle', Icon: Puzzle },
  magic: { label: 'Magic', Icon: WandSparkles },
};

function FlipIconPicker({ value, customUrl, onChange, onChooseCustom }: { value: FlipIconName; customUrl: string; onChange: (value: FlipIconName) => void; onChooseCustom: () => void }) {
  return (
    <div className="lesson-flip__icon-options">
      <button type="button" className="lesson-flip__icon-option lesson-flip__icon-none" data-active={value === 'none' && !customUrl ? 'true' : 'false'} aria-label="No icon" title="No icon" onMouseDown={(event) => { event.preventDefault(); onChange('none'); }}><X width={13} height={13} /></button>
      {(Object.entries(FLIP_ICONS) as [Exclude<FlipIconName, 'none'>, (typeof FLIP_ICONS)[Exclude<FlipIconName, 'none'>]][]).map(([name, { label, Icon }]) => (
        <button key={name} type="button" className="lesson-flip__icon-option" data-active={value === name ? 'true' : 'false'} aria-label={`${label} icon`} title={label} onMouseDown={(event) => { event.preventDefault(); onChange(name); }}><Icon width={14} height={14} /></button>
      ))}
      <button type="button" className="lesson-flip__icon-option lesson-flip__icon-custom" data-active={customUrl ? 'true' : 'false'} aria-label="Choose or upload a custom icon" title="Custom icon" onMouseDown={(event) => { event.preventDefault(); onChooseCustom(); }}><ImageIcon width={14} height={14} /></button>
    </div>
  );
}

function FlipCardView({ node, getPos, editor, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const front = (node.attrs.front as string) || '';
  const back = (node.attrs.back as string) || '';
  const iconUrl = (node.attrs.iconUrl as string) || '';
  const iconName: FlipIconName = (node.attrs.icon as FlipIconName) in FLIP_ICONS ? (node.attrs.icon as FlipIconName) : 'none';
  const FrontIcon = iconName === 'none' ? null : FLIP_ICONS[iconName].Icon;
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
              <button type="button" className="lesson-flip__control" disabled={index === 0} aria-label={`Move card ${index + 1} up`} title="Move card up" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSelf(-1)}><ArrowUp width={13} height={13} /></button>
              <button type="button" className="lesson-flip__control" disabled={index >= siblingCount - 1} aria-label={`Move card ${index + 1} down`} title="Move card down" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSelf(1)}><ArrowDown width={13} height={13} /></button>
              <button type="button" className="lesson-flip__control" disabled={siblingCount >= MAX_CARDS} aria-label={`Duplicate card ${index + 1}`} title="Duplicate card" onMouseDown={(event) => event.preventDefault()} onClick={duplicateSelf}><Copy width={13} height={13} /></button>
              <StyleMenu><MenuRow label="Front icon"><FlipIconPicker value={iconName} customUrl={iconUrl} onChange={(icon) => updateAttributes({ icon, iconUrl: '' })} onChooseCustom={() => setShowIconLibrary(true)} /></MenuRow></StyleMenu>
              <button type="button" className="lesson-flip__control lesson-flip__remove" disabled={siblingCount <= 1} aria-label={`Delete card ${index + 1}`} title="Delete card" onMouseDown={(event) => event.preventDefault()} onClick={removeSelf}><Trash2 width={13} height={13} /></button>
            </div>
          </div>
          {(iconUrl || FrontIcon) && <span className="lesson-flip__edit-icon">{iconUrl ? <img src={iconUrl} alt="" /> : FrontIcon && <FrontIcon width={16} height={16} aria-hidden="true" />}</span>}
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
            {(iconUrl || FrontIcon) && <span className="lesson-flip__front-icon">{iconUrl ? <img src={iconUrl} alt="" /> : FrontIcon && <FrontIcon width={21} height={21} aria-hidden="true" />}</span>}
            <span className="lesson-flip__text">{front}</span>
            <span className="lesson-flip__hint"><RefreshCw width={12} height={12} /> Tap to reveal</span>
          </span>
          <span className="lesson-flip__face lesson-flip__face--back" aria-hidden={!flipped}>
            <span className="lesson-flip__side-label">Answer</span>
            <span className="lesson-flip__text">{back}</span>
            <span className="lesson-flip__hint"><RefreshCw width={12} height={12} /> Tap to flip back</span>
          </span>
        </span>
      </button>
    </NodeViewWrapper>
  );
}

function FlipDeckView({ node, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;

  const addCard = () => {
    if (count >= MAX_CARDS) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, { type: 'flipCard', attrs: { front: '', back: '', icon: 'none', iconUrl: '' } }).run();
  };

  return (
    <NodeViewWrapper className="lesson-flip-deck">
      <NodeViewContent className="lesson-flip-deck__grid" />
      {editable && (
        <div className="lesson-block-footer" contentEditable={false}>
          {count < MAX_CARDS && (
            <button type="button" className="lesson-flip-deck__add" onMouseDown={(e) => e.preventDefault()} onClick={addCard}>
              <Plus width={13} height={13} /> Add card
            </button>
          )}
          <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="flip-card deck" />
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
