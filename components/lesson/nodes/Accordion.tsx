'use client';

// Accordion: a container of collapsible sections.
//
// `accordion` holds one or more `accordionItem`s and (in the editor) shows an
// "Add section" button. Each item has a title, an optional uploaded logo and subtitle, and a
// foldable body: in the editor the header fields remain directly editable and the body can be
// collapsed to reduce visual noise; in the player the full header toggles the body. Visibility
// and theming are handled by CSS keyed off `.lesson-accordion__item[data-open]` (see
// LessonContentStyles).
//
// Logos may come from Brandfetch's live Logo API or ImageLibrary / Cloudinary. Both are stored as
// full URLs; uploaded images are collected by extractDocImageUrls for cleanup.

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ImagePlus, Minus, Plus, X } from 'lucide-react';
import { ImageLibrary } from '@/components/ImageLibrary';
import { BrandfetchLogoPicker } from '@/components/BrandfetchLogoPicker';
import { BRANDFETCH_CLIENT_ID, resolveBrandLogoUrl } from '@/lib/brandfetch';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, StyleMenu, MenuRow, accentScope, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';

function AccordionItemView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const [open, setOpen] = useState<boolean>(editable ? true : !!node.attrs.open);
  const title = (node.attrs.title as string) || '';
  const subtitle = (node.attrs.subtitle as string) || '';
  const logoUrl = (node.attrs.logoUrl as string) || '';
  const brandDomain = (node.attrs.brandDomain as string) || '';
  // Rebuilt from the brand domain where there is one, so a rotated client id cannot break logos
  // already saved in published lessons.
  const logoSrc = resolveBrandLogoUrl(logoUrl, brandDomain);
  const accentColor = (node.attrs.accentColor as string) || '';
  // Per ITEM, not per accordion: in the app-card pattern each section is a different product, so
  // each carries its own brand colour for its logo tile and toggle.
  const accent = accentScope(accentColor);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const toggle = () => setOpen((current) => !current);

  // Deliberately does NOT delete the image it displaces. The picker is the shared library, so the
  // same URL can be a logo on another section, an image in another lesson, or a course cover --
  // hard-deleting it would blank all of them. This matches every sibling block: the carousel never
  // deletes a replaced cover, and LessonImage only deletes crops it generated itself, never a
  // library original. Orphans are handled at lesson-delete time, where extractDocImageUrls
  // (lib/lesson-doc.ts) already collects logoUrl.
  const setLogo = (next: string) => {
    if (next === logoUrl) return;
    updateAttributes({ logoUrl: next, brandName: '', brandDomain: '' });
  };
  const canRemove = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!editable || typeof getPos !== 'function') return false;
      try {
        const pos = getPos();
        return pos != null && currentEditor.state.doc.resolve(pos).parent.childCount > 1;
      } catch {
        return false;
      }
    },
  });
  const removeSelf = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };
  const toggleIcon = (
    <span className="lesson-accordion__toggle-icon" aria-hidden="true">
      <Plus className="lesson-accordion__plus" width={17} height={17} />
      <Minus className="lesson-accordion__minus" width={17} height={17} />
    </span>
  );

  const logoImage = logoSrc
    ? <img className="lesson-accordion__logo" src={logoSrc} alt="" draggable={false} />
    : null;

  return (
    <NodeViewWrapper className={`lesson-accordion__item ${accent.className}`.trim()} data-open={open ? 'true' : 'false'} style={accent.style}>
      {editable ? (
        <div className="lesson-accordion__head" contentEditable={false}>
          <span className="lesson-accordion__logo-slot">
            <button
              type="button"
              className="lesson-accordion__logo-btn"
              data-empty={logoUrl ? 'false' : 'true'}
              aria-label={logoUrl ? 'Replace section logo' : 'Add a section logo'}
              title={logoUrl ? 'Replace logo' : 'Add logo'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (BRANDFETCH_CLIENT_ID ? setShowBrandPicker(true) : setShowLibrary(true))}
            >
              {logoImage ?? <ImagePlus width={15} height={15} aria-hidden="true" />}
            </button>
            {logoUrl && (
              <button
                type="button"
                className="lesson-accordion__logo-clear"
                aria-label="Remove section logo"
                title="Remove logo"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setLogo('')}
              >
                <X width={11} height={11} aria-hidden="true" />
              </button>
            )}
          </span>
          <span className="lesson-accordion__heading">
            <NodeTextInput
              className="lesson-accordion__title-input"
              value={title}
              placeholder="Section title"
              onCommit={(v) => updateAttributes({ title: v })}
            />
            <NodeTextInput
              className="lesson-accordion__subtitle-input"
              value={subtitle}
              placeholder="Subtitle (optional)"
              onCommit={(v) => updateAttributes({ subtitle: v })}
            />
          </span>
          <StyleMenu width={210}>
            <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Section accent" /></MenuRow>
          </StyleMenu>
          <button type="button" className="lesson-accordion__editor-toggle" aria-label={open ? 'Collapse section' : 'Expand section'} aria-expanded={open} onMouseDown={(event) => { event.preventDefault(); toggle(); }}>
            {toggleIcon}
          </button>
          {canRemove && (
            <button type="button" className="lesson-accordion__remove" aria-label="Remove section" title="Remove section" onMouseDown={(event) => event.preventDefault()} onClick={removeSelf}>
              <X width={12} height={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="lesson-accordion__head" aria-expanded={open} onClick={toggle}>
          {logoImage}
          <span className="lesson-accordion__heading">
            <span className="lesson-accordion__title">{title || 'Section'}</span>
            {subtitle && <span className="lesson-accordion__subtitle">{subtitle}</span>}
          </span>
          {toggleIcon}
        </button>
      )}
      <div className="lesson-accordion__body-shell">
        <NodeViewContent className="lesson-accordion__body" />
      </div>
      {showLibrary && (
        <ImageLibrary
          uploadFolder="lesson-images"
          initialFolder="lesson-images"
          onSelect={(url) => { setLogo(url); setShowLibrary(false); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
      {showBrandPicker && (
        <BrandfetchLogoPicker
          onSelect={(brand) => updateAttributes({
            logoUrl: brand.logoUrl,
            brandName: brand.name,
            brandDomain: brand.domain,
            ...(title.trim() ? {} : { title: brand.name }),
          })}
          onOpenLibrary={() => setShowLibrary(true)}
          onClose={() => setShowBrandPicker(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

function AccordionView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;

  // Border applies to the whole accordion (all sections) via inherited CSS variables.
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'solid';
  const borderColor = (node.attrs.borderColor as string) || '';
  const accVars = {
    '--acc-border-style': borderStyle === 'none' ? 'none' : borderStyle,
    '--acc-border-width': borderStyle === 'none' ? '0' : '1px',
    ...(borderColor ? { '--acc-border-color': borderColor } : {}),
  } as React.CSSProperties;

  const addSection = () => {
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, {
      type: 'accordionItem',
      attrs: { title: '', open: false },
      content: [{ type: 'paragraph' }],
    }).run();
  };

  return (
    <NodeViewWrapper className="lesson-accordion" style={accVars}>
      {editable && (
        <div className="lesson-accordion__toolbar">
          <span className="lesson-block-actions">
            <StyleMenu>
              <MenuRow label="Border"><Segmented<BorderStyle> value={borderStyle} onChange={(v) => updateAttributes({ borderStyle: v })} options={BORDER_STYLE_OPTIONS} /></MenuRow>
              {borderStyle !== 'none' && (
                <MenuRow label="Color"><ColorField value={borderColor} onChange={(v) => updateAttributes({ borderColor: v })} /></MenuRow>
              )}
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="collapsible sections" />
          </span>
        </div>
      )}
      <NodeViewContent className="lesson-accordion__items" />
      {editable && (
        <button
          type="button"
          className="lesson-accordion__add"
          contentEditable={false}
          onMouseDown={(e) => { e.preventDefault(); addSection(); }}
        >
          <Plus width={13} height={13} /> Add section
        </button>
      )}
    </NodeViewWrapper>
  );
}

export const AccordionItem = Node.create({
  name: 'accordionItem',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
      subtitle: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-subtitle') || '',
        renderHTML: (attrs) => ({ 'data-subtitle': attrs.subtitle }),
      },
      // Uploaded via ImageLibrary (Cloudinary). Kept as a full URL like every other lesson
      // image, so extractDocImageUrls can find it for cleanup.
      logoUrl: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-logo-url') || '',
        renderHTML: (attrs) => ({ 'data-logo-url': attrs.logoUrl }),
      },
      // Brand metadata accompanies Brandfetch selections. It lets future editor features refresh
      // or relabel the logo without a paid Brand API call; manual uploads leave both fields empty.
      brandName: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-brand-name') || '',
        renderHTML: (attrs) => ({ 'data-brand-name': attrs.brandName }),
      },
      brandDomain: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-brand-domain') || '',
        renderHTML: (attrs) => ({ 'data-brand-domain': attrs.brandDomain }),
      },
      // Empty = follow the tenant accent, so untouched sections are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
      open: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-open') === 'true',
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-accordion-item]' }];
  },

  // Fallback HTML: title as a bold line, then the subtitle, then the body. sanitizeRichText
  // strips the wrapping divs but keeps their children, so all three survive as readable text.
  // The logo is not emitted here: the canonical doc holds it, and an <img> in the lossy body
  // would duplicate it on every legacy render.
  renderHTML({ node, HTMLAttributes }) {
    const subtitle = ((node.attrs.subtitle as string) || '').trim();
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-accordion-item': '' }),
      ['p', ['strong', (node.attrs.title as string) || '']],
      ...(subtitle ? [['p', ['em', subtitle]]] : []),
      ['div', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AccordionItemView);
  },
});

export const Accordion = Node.create({
  name: 'accordion',
  group: 'block',
  content: 'accordionItem+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      borderStyle: { default: 'solid' },
      borderColor: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-accordion]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-accordion': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AccordionView);
  },
});
