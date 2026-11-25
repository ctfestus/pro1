'use client';

// Icon grid: a set of short items, each an icon, a title and one line, for "What you will learn",
// key ideas or a tool roundup. `iconGrid` holds `iconGridItem` atoms whose text lives in attrs,
// like flip cards. Two looks: "cards" (tinted tiles in one white panel, with an optional heading)
// and "compact" (white rows with a round icon and the title only, for a short list).

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, useEditorState, type NodeViewProps } from '@tiptap/react';
import { Plus, X } from '@phosphor-icons/react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { ColorField, MenuRow, Segmented, StyleMenu, accentScope } from '@/components/lesson/nodes/StyleControls';
import { LessonIcon } from '@/components/lesson/LessonIcon';
import { LessonIconButton } from '@/components/lesson/LessonIconPicker';
import { resolveLessonIconKey } from '@/lib/lesson-icons';

const MAX_ITEMS = 12;

type GridStyle = 'cards' | 'compact';
type GridColumns = '2' | '3' | '4';

const STYLE_OPTIONS: { value: GridStyle; label: string }[] = [
  { value: 'cards', label: 'Cards' },
  { value: 'compact', label: 'Compact' },
];
const COLUMN_OPTIONS: { value: GridColumns; label: string }[] = [
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
];

function IconGridItemView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const icon = resolveLessonIconKey(node.attrs.icon);
  const title = (node.attrs.title as string) || '';
  const text = (node.attrs.text as string) || '';
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

  if (editable) {
    return (
      <NodeViewWrapper className="lesson-icon-grid__item" data-editing="true" contentEditable={false}>
        <LessonIconButton className="lesson-icon-grid__icon lesson-icon-grid__icon-btn" value={icon} onChange={(key) => updateAttributes({ icon: key })} title="Item icon" />
        <span className="lesson-icon-grid__words">
          <NodeTextInput className="lesson-icon-grid__title-input" value={title} placeholder="Title" onCommit={(v) => updateAttributes({ title: v })} />
          <NodeTextInput multiline className="lesson-icon-grid__text-input" value={text} placeholder="One short line" onCommit={(v) => updateAttributes({ text: v })} />
        </span>
        {canRemove && (
          <button type="button" className="lesson-icon-grid__remove" aria-label="Remove item" title="Remove item" onMouseDown={(e) => e.preventDefault()} onClick={removeSelf}>
            <X weight="bold" width={12} height={12} aria-hidden="true" />
          </button>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="lesson-icon-grid__item">
      {icon && <span className="lesson-icon-grid__icon"><LessonIcon name={icon} size={24} /></span>}
      <span className="lesson-icon-grid__words">
        {title && <span className="lesson-icon-grid__title">{title}</span>}
        {text && <span className="lesson-icon-grid__text">{text}</span>}
      </span>
    </NodeViewWrapper>
  );
}

function IconGridView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const count = node.childCount;
  const title = (node.attrs.title as string) || '';
  const style: GridStyle = node.attrs.style === 'compact' ? 'compact' : 'cards';
  const columns: GridColumns = (['2', '3', '4'] as const).includes(String(node.attrs.columns) as GridColumns) ? (String(node.attrs.columns) as GridColumns) : '3';
  const accentColor = (node.attrs.accentColor as string) || '';
  const accent = accentScope(accentColor);

  const addItem = () => {
    if (count >= MAX_ITEMS) return;
    const base = typeof getPos === 'function' ? getPos() : undefined;
    if (base == null) return;
    editor.chain().focus().insertContentAt(base + node.nodeSize - 1, { type: 'iconGridItem', attrs: { icon: '', title: '', text: '' } }).run();
  };

  return (
    <NodeViewWrapper
      className={`lesson-icon-grid ${accent.className}`.trim()}
      data-style={style}
      style={{ ...accent.style, '--icon-grid-cols': columns } as React.CSSProperties}
    >
      {editable ? (
        <div contentEditable={false}>
          <NodeTextInput className="lesson-icon-grid__heading-input" value={title} placeholder="Heading (optional), e.g. What you will learn" onCommit={(v) => updateAttributes({ title: v })} />
        </div>
      ) : title ? (
        <h3 className="lesson-icon-grid__heading">{title}</h3>
      ) : null}
      <NodeViewContent className="lesson-icon-grid__items" />
      {editable && (
        <div className="lesson-block-footer" contentEditable={false}>
          {count < MAX_ITEMS && (
            <button type="button" className="lesson-icon-grid__add" onMouseDown={(e) => e.preventDefault()} onClick={addItem}>
              <Plus weight="bold" width={13} height={13} /> Add item
            </button>
          )}
          <span className="lesson-block-actions">
            <StyleMenu width={230}>
              <MenuRow label="Style"><Segmented<GridStyle> value={style} onChange={(v) => updateAttributes({ style: v })} options={STYLE_OPTIONS} /></MenuRow>
              <MenuRow label="Columns"><Segmented<GridColumns> value={columns} onChange={(v) => updateAttributes({ columns: v })} options={COLUMN_OPTIONS} /></MenuRow>
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Icon grid accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="icon grid" />
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const IconGridItem = Node.create({
  name: 'iconGridItem',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // A key from lib/lesson-icons.
      icon: { default: '' },
      title: { default: '' },
      text: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-icon-grid-item]' }];
  },

  // Fallback HTML: title (bold) + line, readable once the sanitizer drops the wrapper.
  renderHTML({ node, HTMLAttributes }) {
    const text = (node.attrs.text as string) || '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-icon-grid-item': '' }),
      ['p', ['strong', (node.attrs.title as string) || '']],
      ...(text ? [['p', text]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IconGridItemView);
  },
});

export const IconGrid = Node.create({
  name: 'iconGrid',
  group: 'block',
  content: 'iconGridItem+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      title: { default: '' },
      style: { default: 'cards' },
      columns: { default: '3' },
      // Empty = follow the tenant accent.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-icon-grid]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || '';
    return ['div', mergeAttributes(HTMLAttributes, { 'data-icon-grid': '' }), ...(title ? [['p', ['strong', title]]] : []), ['div', 0]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IconGridView);
  },
});
