'use client';

// Callout block: a styled note / tip / warning / info / success box that holds any
// block content. Has an editable title, an editable eyebrow label, a pickable icon, a variant
// (which sets the color scheme), and optional border-style + free border-color overrides.
// Authors can also pick the corner shape, an optional accent bar on one edge, and a free accent
// color that replaces the variant's color across the bar, icon, label and tint.
//
// The variant sets the COLOR scheme and supplies the default label + icon. `label` and `icon`
// override those independently, so a warning-coloured box can read "Watch out" with a clock on it.
// Both fall back to the variant's default when empty, so existing callouts are unchanged.
//
// Variant theming is via CSS keyed off `.lesson-callout[data-variant]`; border
// style/color overrides are applied inline so they win over the variant defaults.

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { ArrowUpRight, CheckCircle, Copy, FileText, Info, Lightbulb, Plus, Warning, X } from '@phosphor-icons/react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, StyleMenu, MenuRow, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { safeCalloutActionUrl } from '@/lib/lesson-callout';
import { resolveLessonIconKey } from '@/lib/lesson-icons';
import { LessonIcon } from '@/components/lesson/LessonIcon';
import { LessonIconPanel } from '@/components/lesson/LessonIconPicker';

export type CalloutVariant = 'note' | 'tip' | 'warning' | 'info' | 'success';

const VARIANTS: Record<CalloutVariant, { label: string; Icon: typeof Info }> = {
  note: { label: 'Note', Icon: FileText },
  tip: { label: 'Tip', Icon: Lightbulb },
  warning: { label: 'Warning', Icon: Warning },
  info: { label: 'Info', Icon: Info },
  success: { label: 'Success', Icon: CheckCircle },
};

type CalloutShape = 'rounded' | 'square';
type CalloutAccentPosition = 'top' | 'right' | 'bottom' | 'none';

const SHAPE_OPTIONS: { value: CalloutShape; label: string }[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
];

// The left bar was the old default and is retired: the approved look is a tinted note with no side
// bar, so 'left' (stored on every callout made before) now reads as 'none'.
const ACCENT_POSITION_OPTIONS: { value: CalloutAccentPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'none', label: 'None' },
];

const VARIANT_OPTIONS: { value: CalloutVariant; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'tip', label: 'Tip' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
];

function CalloutView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const variant: CalloutVariant = (node.attrs.variant as CalloutVariant) in VARIANTS
    ? (node.attrs.variant as CalloutVariant)
    : 'note';
  const fallback = VARIANTS[variant];
  const customLabel = (node.attrs.label as string) || '';
  // Any key from the shared lesson icon set; empty or unknown falls back to the variant's icon.
  const iconKey = resolveLessonIconKey(node.attrs.icon);
  // Both fall back to the variant, so a callout authored before these existed looks identical.
  const label = customLabel.trim() || fallback.label;
  const FallbackIcon = fallback.Icon;
  const title = (node.attrs.title as string) || '';
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'solid';
  const borderColor = (node.attrs.borderColor as string) || '';
  const shape: CalloutShape = node.attrs.shape === 'square' ? 'square' : 'rounded';
  const accentPosition: CalloutAccentPosition = ACCENT_POSITION_OPTIONS.some((o) => o.value === node.attrs.accentPosition)
    ? (node.attrs.accentPosition as CalloutAccentPosition)
    : 'none';
  const accentColor = ((node.attrs.accentColor as string) || '').trim();
  const actionLabel = (node.attrs.actionLabel as string) || '';
  const actionUrl = (node.attrs.actionUrl as string) || '';
  const [actionOpen, setActionOpen] = useState(!!(actionLabel || actionUrl));
  const showAction = actionOpen || !!(actionLabel || actionUrl);
  const safeUrl = safeCalloutActionUrl(actionUrl);

  // Override border inline; leave color to the variant CSS unless a custom one is set.
  // A custom accent re-declares the callout's color vars inline so it wins over the variant.
  const wrapperStyle = {
    ...(borderStyle === 'none'
      ? { border: 'none' }
      : { borderStyle, borderWidth: 1, borderColor: borderColor || 'var(--callout-border)' }),
    ...(accentColor ? {
      '--callout-accent': accentColor,
      '--callout-ink': `color-mix(in oklab, ${accentColor} 78%, #000)`,
    } : {}),
  } as React.CSSProperties;

  const duplicateSelf = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
  };

  const removeSelf = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  const removeAction = () => {
    updateAttributes({ actionLabel: '', actionUrl: '' });
    setActionOpen(false);
  };

  return (
    <NodeViewWrapper className="lesson-callout" data-variant={variant} data-shape={shape} data-accent={accentPosition} data-custom-accent={accentColor ? '' : undefined} style={wrapperStyle}>
      <div className="lesson-callout__icon-wrap" contentEditable={false}>
        {iconKey
          ? <LessonIcon name={iconKey} size={17} className="lesson-callout__icon" fallback={<FallbackIcon weight="duotone" className="lesson-callout__icon" width={17} height={17} />} />
          : <FallbackIcon weight="duotone" className="lesson-callout__icon" width={17} height={17} />}
      </div>
      <div className="lesson-callout__main">
        <div className="lesson-callout__head" contentEditable={false}>
          <div className="lesson-callout__heading">
            {editable ? (
              <NodeTextInput
                className="lesson-callout__eyebrow-input"
                value={customLabel}
                placeholder={fallback.label}
                onCommit={(v) => updateAttributes({ label: v })}
              />
            ) : null}
            {editable ? (
              <NodeTextInput className="lesson-callout__title-input" value={title} placeholder="Optional title" onCommit={(v) => updateAttributes({ title: v })} />
            ) : (
              // The learner sees one icon and one title. With no title, the label is the title.
              <p className="lesson-callout__title">{title.trim() || label}</p>
            )}
          </div>
          {editable && (
            <div className="lesson-callout__controls">
              <button type="button" className="lesson-callout__control" aria-label="Duplicate callout" title="Duplicate" onMouseDown={(event) => { event.preventDefault(); duplicateSelf(); }}><Copy weight="bold" width={13} height={13} /></button>
              <StyleMenu width={320}>
                <MenuRow label="Style"><Segmented<CalloutVariant> value={variant} onChange={(v) => updateAttributes({ variant: v })} options={VARIANT_OPTIONS} /></MenuRow>
                <MenuRow label="Shape"><Segmented<CalloutShape> value={shape} onChange={(v) => updateAttributes({ shape: v })} options={SHAPE_OPTIONS} /></MenuRow>
                <MenuRow label="Accent bar"><Segmented<CalloutAccentPosition> value={accentPosition} onChange={(v) => updateAttributes({ accentPosition: v })} options={ACCENT_POSITION_OPTIONS} /></MenuRow>
                <MenuRow label="Accent color"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Accent color" /></MenuRow>
                <MenuRow label="Icon"><LessonIconPanel value={iconKey} noneLabel="Match the style" onChange={(v) => updateAttributes({ icon: v })} /></MenuRow>
                <MenuRow label="Border"><Segmented<BorderStyle> value={borderStyle} onChange={(v) => updateAttributes({ borderStyle: v })} options={BORDER_STYLE_OPTIONS} /></MenuRow>
                {borderStyle !== 'none' && (
                  <MenuRow label="Border color"><ColorField value={borderColor} onChange={(v) => updateAttributes({ borderColor: v })} /></MenuRow>
                )}
              </StyleMenu>
              <button type="button" className="lesson-callout__control lesson-callout__remove" aria-label="Remove callout" title="Remove" onMouseDown={(event) => { event.preventDefault(); removeSelf(); }}><X weight="bold" width={13} height={13} /></button>
            </div>
          )}
        </div>
        <NodeViewContent className="lesson-callout__body" />

        {editable && !showAction && (
          <button type="button" className="lesson-callout__add-action" contentEditable={false} onMouseDown={(event) => { event.preventDefault(); setActionOpen(true); }}><Plus weight="bold" width={12} height={12} /> Add action</button>
        )}
        {editable && showAction && (
          <div className="lesson-callout__action-editor" contentEditable={false}>
            <NodeTextInput className="lesson-callout__action-input" value={actionLabel} placeholder="Action label" onCommit={(value) => updateAttributes({ actionLabel: value })} />
            <NodeTextInput className="lesson-callout__action-input" value={actionUrl} placeholder="https://... or /course/path" onCommit={(value) => updateAttributes({ actionUrl: value })} />
            <button type="button" className="lesson-callout__remove-action" aria-label="Remove action" title="Remove action" onMouseDown={(event) => { event.preventDefault(); removeAction(); }}><X weight="bold" width={12} height={12} /></button>
          </div>
        )}
        {!editable && actionLabel && safeUrl && (
          <a className="lesson-callout__action" href={safeUrl} target={safeUrl.startsWith('/') ? undefined : '_blank'} rel={safeUrl.startsWith('/') ? undefined : 'noopener noreferrer'}>
            {actionLabel}<ArrowUpRight weight="bold" width={13} height={13} />
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'note',
        parseHTML: (el) => el.getAttribute('data-variant') || 'note',
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
      title: { default: '' },
      // Empty = use the variant's default eyebrow label / icon.
      label: { default: '' },
      icon: { default: '' },
      borderStyle: { default: 'none' },
      borderColor: { default: '' },
      // Rounded corners, no accent bar, variant color.
      shape: { default: 'rounded' },
      accentPosition: { default: 'none' },
      accentColor: { default: '' },
      actionLabel: { default: '' },
      actionUrl: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }, { tag: 'blockquote[data-callout]' }];
  },

  // Fallback HTML: a custom eyebrow label and the optional title (both bold) + body, inside a
  // blockquote the sanitizer keeps. A custom label is authored content, so it is carried here; the
  // variant's DEFAULT label is styling and stays out, as before. Variant/border/icon live only in
  // the canonical doc.
  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || '';
    const label = ((node.attrs.label as string) || '').trim();
    const actionLabel = (node.attrs.actionLabel as string) || '';
    const actionUrl = safeCalloutActionUrl((node.attrs.actionUrl as string) || '');
    return [
      'blockquote',
      mergeAttributes(HTMLAttributes, { 'data-callout': '' }),
      ...(label ? [['p', ['strong', label]]] : []),
      ...(title ? [['p', ['strong', title]]] : []),
      ['div', 0],
      ...(actionLabel && actionUrl ? [['p', ['a', { href: actionUrl }, actionLabel]]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
