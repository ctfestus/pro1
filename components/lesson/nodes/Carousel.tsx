'use client';

// Carousel: a stepped lesson container -- learners page through slides with an
// integrated previous/next footer, progress rail, and direct slide indicators.
//
// Same visibility mechanism as Tabs: active index is local React state surfaced as
// data-active on the wrapper; each slide tags itself with data-slide-index; CSS pairs
// them so only the active slide shows -- no fragile cross-node ProseMirror reactivity.
// Capped at 20 slides (the :nth pairs + addSlide guard).
//
// Card appearance (roundness + border) is set ONCE on the carousel and applied to
// EVERY slide via inherited CSS variables (--card-radius / --cover-radius /
// --card-border-*). Per-slide attrs are content only (cover image, title).

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import { ImageLibrary } from '@/components/ImageLibrary';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, StyleMenu, MenuRow, accentScope, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';

const MAX_SLIDES = 20;

type RadiusKey = 'none' | 'sm' | 'md' | 'lg';
const CARD_RADIUS: Record<RadiusKey, number> = { none: 0, sm: 8, md: 14, lg: 22 };
const COVER_RADIUS: Record<RadiusKey, number> = { none: 0, sm: 6, md: 10, lg: 16 };
const RADIUS_OPTIONS: { value: RadiusKey; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
];

function CarouselView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;
  const [active, setActive] = useState(0);
  const [hasNavigated, setHasNavigated] = useState(false);
  const current = Math.min(active, count - 1);

  // Carousel-wide card appearance, applied to all slides via CSS variables.
  const radius = (node.attrs.radius as RadiusKey) in CARD_RADIUS ? (node.attrs.radius as RadiusKey) : 'md';
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'none';
  const borderColor = (node.attrs.borderColor as string) || '';
  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the slide dots and the visited check.
  const accent = accentScope(accentColor);
  const cardVars = {
    '--card-radius': `${CARD_RADIUS[radius]}px`,
    '--cover-radius': `${COVER_RADIUS[radius]}px`,
    '--card-border-style': borderStyle === 'none' ? 'none' : borderStyle,
    '--card-border-width': borderStyle === 'none' ? '0' : '1px',
    ...(borderColor ? { '--card-border-color': borderColor } : {}),
    ...accent.style,
  } as React.CSSProperties;

  const go = (i: number) => {
    const next = Math.max(0, Math.min(i, count - 1));
    if (next !== current) setHasNavigated(true);
    setActive(next);
  };

  const childPos = (index: number): number | null => {
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return null;
    let found: number | null = null;
    node.forEach((_child, offset, i) => { if (i === index) found = base + 1 + offset; });
    return found;
  };

  const addSlide = () => {
    if (count >= MAX_SLIDES) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, { type: 'carouselSlide', content: [{ type: 'paragraph' }] }).run();
    setActive(count);
  };

  const removeSlide = (index: number) => {
    if (count <= 1) return;
    const pos = childPos(index);
    if (pos == null) return;
    const size = node.child(index).nodeSize;
    editor.chain().focus().deleteRange({ from: pos, to: pos + size }).run();
    setActive((a) => Math.max(0, Math.min(a, count - 2)));
  };

  const moveSlide = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const slides = Array.from({ length: count }, (_, index) => node.child(index));
    const [moved] = slides.splice(from, 1);
    slides.splice(to, 0, moved);
    const transaction = editor.state.tr.replaceWith(base + 1, base + node.nodeSize - 1, Fragment.fromArray(slides));
    editor.view.dispatch(transaction);
    editor.commands.focus();
    setActive(to);
  };

  return (
    <NodeViewWrapper className={`lesson-carousel ${accent.className}`.trim()} data-active={current} data-hint={!editable && !hasNavigated && count > 1 ? 'true' : 'false'} style={cardVars}>
      <div className="lesson-carousel__viewport">
        <button
          type="button"
          className="lesson-carousel__arrow"
          aria-label="Previous slide"
          disabled={current === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => go(current - 1)}
        >
          <ChevronLeft width={18} height={18} aria-hidden="true" />
        </button>
        <div className="lesson-carousel__stage">
          {!editable && !hasNavigated && count > 1 && (
            <div className="lesson-carousel__hint" role="status">
              <span className="lesson-carousel__hint-dot" aria-hidden="true" />
              <span>Use the arrows to explore</span>
            </div>
          )}
          <NodeViewContent className="lesson-carousel__slides" />
        </div>
        <button
          type="button"
          className="lesson-carousel__arrow"
          aria-label="Next slide"
          disabled={current >= count - 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => go(current + 1)}
        >
          <ChevronRight width={18} height={18} aria-hidden="true" />
        </button>
      </div>

      <div className="lesson-carousel__footer" contentEditable={false}>
        <div className="lesson-carousel__nav" aria-label="Carousel slides">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              type="button"
              className="lesson-carousel__dot"
              data-active={i === current ? 'true' : 'false'}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === current ? 'step' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(i)}
            />
          ))}
        </div>
      </div>

      {editable && (
        <div className="lesson-carousel__editor-controls" contentEditable={false}>
          <span>Slide {current + 1}</span>
          <div>
            <button type="button" disabled={current === 0} aria-label="Move current slide left" title="Move slide left" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSlide(current, current - 1)}><ChevronLeft width={13} height={13} /></button>
            <button type="button" disabled={current >= count - 1} aria-label="Move current slide right" title="Move slide right" onMouseDown={(event) => event.preventDefault()} onClick={() => moveSlide(current, current + 1)}><ChevronRight width={13} height={13} /></button>
            {count > 1 && <button type="button" className="lesson-carousel__editor-delete" aria-label="Delete current slide" title="Delete current slide" onMouseDown={(event) => event.preventDefault()} onClick={() => removeSlide(current)}><Trash2 width={13} height={13} /><span>Delete</span></button>}
            {count < MAX_SLIDES && (
          <button
            type="button"
            className="lesson-carousel__editor-add"
            aria-label="Add slide"
            onMouseDown={(event) => event.preventDefault()}
            onClick={addSlide}
          >
            <Plus width={13} height={13} /><span>Add slide</span>
          </button>
            )}
            <StyleMenu>
              <MenuRow label="Roundness"><Segmented<RadiusKey> value={radius} onChange={(v) => updateAttributes({ radius: v })} options={RADIUS_OPTIONS} /></MenuRow>
              <MenuRow label="Card border"><Segmented<BorderStyle> value={borderStyle} onChange={(v) => updateAttributes({ borderStyle: v })} options={BORDER_STYLE_OPTIONS} /></MenuRow>
              {borderStyle !== 'none' && (
                <MenuRow label="Color"><ColorField value={borderColor} onChange={(v) => updateAttributes({ borderColor: v })} /></MenuRow>
              )}
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Carousel accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="carousel" />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

function CarouselSlideView({ node, getPos, editor, updateAttributes }: NodeViewProps) {
  // Each slide is a card: an optional cover image, an optional title, and the body.
  // Card roundness/border come from the parent carousel's CSS variables. Tags itself
  // with its index; the parent wrapper carries data-active. CSS pairs them so
  // visibility does not depend on ReactNodeViewRenderer's DOM nesting.
  const editable = editor.isEditable;
  const cover = (node.attrs.cover as string) || '';
  const coverAlt = (node.attrs.coverAlt as string) || '';
  const title = (node.attrs.title as string) || '';
  const [showLibrary, setShowLibrary] = useState(false);

  let index = 0;
  if (typeof getPos === 'function') {
    const pos = getPos();
    if (pos != null) {
      try { index = editor.state.doc.resolve(pos).index(); } catch { index = 0; }
    }
  }

  return (
    <NodeViewWrapper className="lesson-carousel__slide" data-slide-index={index}>
      <div className="lesson-carousel__body">
        {cover ? (
          <div className="lesson-carousel__cover-wrap" contentEditable={false}>
            <img className="lesson-carousel__cover" src={cover} alt={coverAlt} draggable={false} />
            {editable && (
              <div className="lesson-carousel__cover-actions">
                <button type="button" className="lesson-carousel__cover-btn" onClick={() => setShowLibrary(true)}>Change</button>
                <button type="button" className="lesson-carousel__cover-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => updateAttributes({ cover: '' })}>Remove</button>
              </div>
            )}
          </div>
        ) : editable ? (
          <button type="button" className="lesson-carousel__cover-add" contentEditable={false} onClick={() => setShowLibrary(true)}>
            <ImageIcon width={15} height={15} />
            Add cover image
          </button>
        ) : null}
        {editable ? (
          <NodeTextInput className="lesson-carousel__title-input" value={title} placeholder="Card title (optional)" onCommit={(v) => updateAttributes({ title: v })} />
        ) : title ? (
          <p className="lesson-carousel__title">{title}</p>
        ) : null}
        <NodeViewContent />
      </div>
      {showLibrary && (
        <ImageLibrary
          uploadFolder="lesson-images"
          initialFolder="lesson-images"
          onSelect={url => updateAttributes({ cover: url })}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

export const CarouselSlide = Node.create({
  name: 'carouselSlide',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      cover: { default: '' },
      coverAlt: { default: '' },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-carousel-slide]' }];
  },

  // Fallback HTML: title as a bold line + body (sanitizer keeps p/strong; the wrapper
  // div is stripped but its children are kept), matching accordion/tab titles.
  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-carousel-slide': '' }),
      ...(title ? [['p', ['strong', title]]] : []),
      ['div', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CarouselSlideView);
  },
});

export const Carousel = Node.create({
  name: 'carousel',
  group: 'block',
  content: 'carouselSlide+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      radius: { default: 'md' },
      borderStyle: { default: 'none' },
      borderColor: { default: '' },
      // Empty = follow the tenant accent, so untouched blocks are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-carousel]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-carousel': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CarouselView);
  },
});
