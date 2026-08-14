'use client';

// Tabs: a tabbed container holding multiple labeled panels.
//
// The active panel is tracked with local React state and surfaced as
// `data-active="<index>"` on the wrapper; CSS (LessonContentStyles) shows only the
// matching panel via :nth-child, so we avoid fragile cross-node ProseMirror
// reactivity (a child panel does not need to observe the parent's state). Panel
// labels live on each tabPanel node; the tab bar edits them through the parent view.
//
// Styling caps at 12 visible panels (the :nth-child rules), and addTab() enforces the
// same cap, which is far above any realistic lesson.

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { Plus, X } from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, StyleMenu, MenuRow, accentScope, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';

const MAX_TABS = 12;

function TabsView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;
  const [active, setActive] = useState(0);
  const current = Math.min(active, count - 1);

  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'none';
  const borderColor = (node.attrs.borderColor as string) || '';
  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the active tab colour and its underline.
  const accent = accentScope(accentColor);
  const wrapperStyle: React.CSSProperties = {
    ...(borderStyle === 'none'
      ? { border: 'none' }
      : { borderStyle, borderWidth: 1, borderColor: borderColor || 'var(--tabs-border)' }),
    ...accent.style,
  };

  const labels: string[] = [];
  node.forEach((child) => labels.push((child.attrs.label as string) || ''));

  const childPos = (index: number): number | null => {
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return null;
    let found: number | null = null;
    node.forEach((_child, offset, i) => { if (i === index) found = base + 1 + offset; });
    return found;
  };

  const setLabel = (index: number, value: string) => {
    const pos = childPos(index);
    if (pos == null) return;
    editor.chain().command(({ tr }) => { tr.setNodeAttribute(pos, 'label', value); return true; }).run();
  };

  const addTab = () => {
    if (count >= MAX_TABS) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    const endInside = base + node.nodeSize - 1;
    editor.chain().focus().insertContentAt(endInside, {
      type: 'tabPanel',
      attrs: { label: `Tab ${count + 1}` },
      content: [{ type: 'paragraph' }],
    }).run();
    setActive(count);
  };

  const removeTab = (index: number) => {
    if (count <= 1) return;
    const pos = childPos(index);
    if (pos == null) return;
    const size = node.child(index).nodeSize;
    editor.chain().focus().deleteRange({ from: pos, to: pos + size }).run();
    setActive((currentActive) => {
      if (index < currentActive) return currentActive - 1;
      if (index === currentActive) return Math.min(currentActive, count - 2);
      return currentActive;
    });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? count - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
    const rail = event.currentTarget.closest('.lesson-tabs__bar');
    setActive(next);
    requestAnimationFrame(() => {
      rail?.querySelector<HTMLButtonElement>(`[role="tab"][data-tab-index="${next}"]`)?.focus();
    });
  };

  return (
    <NodeViewWrapper className={`lesson-tabs ${accent.className}`.trim()} data-active={current} style={wrapperStyle}>
      <div className="lesson-tabs__bar" contentEditable={false} role={editable ? undefined : 'tablist'} aria-label={editable ? undefined : 'Lesson sections'}>
        {labels.map((label, i) => (
          <div key={i} className="lesson-tabs__tab" data-active={i === current ? 'true' : 'false'}>
            {editable ? (
              <>
                <NodeTextInput
                  className="lesson-tabs__label-input"
                  value={label}
                  placeholder={`Tab ${i + 1}`}
                  onFocus={() => setActive(i)}
                  onCommit={(v) => setLabel(i, v)}
                />
                {count > 1 && (
                  <button
                    type="button"
                    className="lesson-tabs__remove"
                    aria-label="Remove tab"
                    onMouseDown={(e) => { e.preventDefault(); removeTab(i); }}
                  >
                    <X width={11} height={11} />
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="lesson-tabs__trigger" role="tab" data-tab-index={i} aria-selected={i === current} tabIndex={i === current ? 0 : -1} onClick={() => setActive(i)} onKeyDown={(event) => handleTabKeyDown(event, i)}>{label || `Tab ${i + 1}`}</button>
            )}
          </div>
        ))}
        {editable && count < MAX_TABS && (
          <button
            type="button"
            className="lesson-tabs__add"
            aria-label="Add tab"
            onMouseDown={(e) => { e.preventDefault(); addTab(); }}
          >
            <Plus width={13} height={13} />
          </button>
        )}
        {editable && (
          <span className="lesson-tabs__style lesson-block-actions">
            <StyleMenu>
              <MenuRow label="Border"><Segmented<BorderStyle> value={borderStyle} onChange={(v) => updateAttributes({ borderStyle: v })} options={BORDER_STYLE_OPTIONS} /></MenuRow>
              {borderStyle !== 'none' && (
                <MenuRow label="Color"><ColorField value={borderColor} onChange={(v) => updateAttributes({ borderColor: v })} /></MenuRow>
              )}
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Tabs accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="tabs" />
          </span>
        )}
      </div>
      <NodeViewContent className="lesson-tabs__panels" />
    </NodeViewWrapper>
  );
}

function TabPanelView({ getPos, editor }: NodeViewProps) {
  // Label lives in the parent tab bar; the panel renders only its body. The panel
  // tags itself with its own index (data-tab-index); the parent wrapper carries
  // data-active. CSS pairs them with a descendant selector, so visibility does not
  // depend on the DOM nesting that ReactNodeViewRenderer produces.
  const index = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (typeof getPos !== 'function') return 0;
      try {
        const pos = getPos();
        return pos == null ? 0 : currentEditor.state.doc.resolve(pos).index();
      } catch {
        return 0;
      }
    },
  });
  return (
    <NodeViewWrapper className="lesson-tab-panel" data-tab-index={index} role={editor.isEditable ? undefined : 'tabpanel'}>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export const TabPanel = Node.create({
  name: 'tabPanel',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-tab-panel]' }];
  },

  // Fallback HTML: label as a bold line + body (divs stripped by the sanitizer but
  // children kept), so every panel's content stays readable in legacy renderers.
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-tab-panel': '' }),
      ['p', ['strong', (node.attrs.label as string) || '']],
      ['div', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabPanelView);
  },
});

export const Tabs = Node.create({
  name: 'tabs',
  group: 'block',
  content: 'tabPanel+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
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
    return [{ tag: 'div[data-tabs]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-tabs': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },
});
