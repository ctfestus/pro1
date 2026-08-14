'use client';

// Callout block: a styled note / tip / warning / info / success box that holds any
// block content. Has an editable title, an editable eyebrow label, a pickable icon, a variant
// (which sets the color scheme), and optional border-style + free border-color overrides.
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
import {
  ArrowUpRight, Copy, Info, Lightbulb, AlertTriangle, FileText, CheckCircle2, Plus, X,
  Star, Flag, Quote, BookOpen, Target, Zap, Clock, HelpCircle, Sparkles, Wrench,
  ShieldCheck, Bookmark, Megaphone, ListChecks, TrendingUp, Users, Ban, Eye, RotateCcw,
} from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, IconPicker, StyleMenu, MenuRow, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { safeCalloutActionUrl } from '@/lib/lesson-callout';

export type CalloutVariant = 'note' | 'tip' | 'warning' | 'info' | 'success';

const VARIANTS: Record<CalloutVariant, { label: string; Icon: typeof Info }> = {
  note: { label: 'Note', Icon: FileText },
  tip: { label: 'Tip', Icon: Lightbulb },
  warning: { label: 'Warning', Icon: AlertTriangle },
  info: { label: 'Info', Icon: Info },
  success: { label: 'Success', Icon: CheckCircle2 },
};

const VARIANT_OPTIONS: { value: CalloutVariant; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'tip', label: 'Tip' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
];

// Icons an author can put on a callout. Keys are stored in the doc, so renaming one would orphan
// existing callouts -- add to this map, never rename. '' means "use the variant's icon".
const CALLOUT_ICONS: Record<string, { label: string; Icon: typeof Info }> = {
  note:      { label: 'Document',    Icon: FileText },
  tip:       { label: 'Lightbulb',   Icon: Lightbulb },
  warning:   { label: 'Warning',     Icon: AlertTriangle },
  info:      { label: 'Info',        Icon: Info },
  success:   { label: 'Check',       Icon: CheckCircle2 },
  star:      { label: 'Star',        Icon: Star },
  flag:      { label: 'Flag',        Icon: Flag },
  quote:     { label: 'Quote',       Icon: Quote },
  book:      { label: 'Reading',     Icon: BookOpen },
  target:    { label: 'Goal',        Icon: Target },
  zap:       { label: 'Fast',        Icon: Zap },
  clock:     { label: 'Time',        Icon: Clock },
  question:  { label: 'Question',    Icon: HelpCircle },
  sparkles:  { label: 'Highlight',   Icon: Sparkles },
  tool:      { label: 'Practice',    Icon: Wrench },
  shield:    { label: 'Best practice', Icon: ShieldCheck },
  bookmark:  { label: 'Remember',    Icon: Bookmark },
  announce:  { label: 'Announcement', Icon: Megaphone },
  checklist: { label: 'Checklist',   Icon: ListChecks },
  trend:     { label: 'Trend',       Icon: TrendingUp },
  people:    { label: 'People',      Icon: Users },
  avoid:     { label: 'Avoid',       Icon: Ban },
  watch:     { label: 'Watch for',   Icon: Eye },
};

const ICON_OPTIONS = [
  { value: '', label: 'Match the style', Icon: RotateCcw },
  ...Object.entries(CALLOUT_ICONS).map(([value, { label, Icon }]) => ({ value, label, Icon })),
];

function CalloutView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const variant: CalloutVariant = (node.attrs.variant as CalloutVariant) in VARIANTS
    ? (node.attrs.variant as CalloutVariant)
    : 'note';
  const fallback = VARIANTS[variant];
  const customLabel = (node.attrs.label as string) || '';
  const iconKey = (node.attrs.icon as string) || '';
  // Both fall back to the variant, so a callout authored before these existed looks identical.
  const label = customLabel.trim() || fallback.label;
  const Icon = (iconKey && CALLOUT_ICONS[iconKey]?.Icon) || fallback.Icon;
  const title = (node.attrs.title as string) || '';
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'solid';
  const borderColor = (node.attrs.borderColor as string) || '';
  const actionLabel = (node.attrs.actionLabel as string) || '';
  const actionUrl = (node.attrs.actionUrl as string) || '';
  const [actionOpen, setActionOpen] = useState(!!(actionLabel || actionUrl));
  const showAction = actionOpen || !!(actionLabel || actionUrl);
  const safeUrl = safeCalloutActionUrl(actionUrl);

  // Override border inline; leave color to the variant CSS unless a custom one is set.
  const wrapperStyle: React.CSSProperties = borderStyle === 'none'
    ? { border: 'none' }
    : { borderStyle, borderWidth: 1, borderColor: borderColor || 'var(--callout-border)' };

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
    <NodeViewWrapper className="lesson-callout" data-variant={variant} style={wrapperStyle}>
      <div className="lesson-callout__icon-wrap" contentEditable={false}>
        <Icon className="lesson-callout__icon" width={17} height={17} />
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
            ) : (
              <span className="lesson-callout__eyebrow">{label}</span>
            )}
            {editable ? (
              <NodeTextInput className="lesson-callout__title-input" value={title} placeholder="Optional title" onCommit={(v) => updateAttributes({ title: v })} />
            ) : title ? (
              <p className="lesson-callout__title">{title}</p>
            ) : null}
          </div>
          {editable && (
            <div className="lesson-callout__controls">
              <button type="button" className="lesson-callout__control" aria-label="Duplicate callout" title="Duplicate" onMouseDown={(event) => { event.preventDefault(); duplicateSelf(); }}><Copy width={13} height={13} /></button>
              <StyleMenu width={272}>
                <MenuRow label="Style"><Segmented<CalloutVariant> value={variant} onChange={(v) => updateAttributes({ variant: v })} options={VARIANT_OPTIONS} /></MenuRow>
                <MenuRow label="Icon"><IconPicker value={iconKey} onChange={(v) => updateAttributes({ icon: v })} options={ICON_OPTIONS} /></MenuRow>
                <MenuRow label="Border"><Segmented<BorderStyle> value={borderStyle} onChange={(v) => updateAttributes({ borderStyle: v })} options={BORDER_STYLE_OPTIONS} /></MenuRow>
                {borderStyle !== 'none' && (
                  <MenuRow label="Color"><ColorField value={borderColor} onChange={(v) => updateAttributes({ borderColor: v })} /></MenuRow>
                )}
              </StyleMenu>
              <button type="button" className="lesson-callout__control lesson-callout__remove" aria-label="Remove callout" title="Remove" onMouseDown={(event) => { event.preventDefault(); removeSelf(); }}><X width={13} height={13} /></button>
            </div>
          )}
        </div>
        <NodeViewContent className="lesson-callout__body" />

        {editable && !showAction && (
          <button type="button" className="lesson-callout__add-action" contentEditable={false} onMouseDown={(event) => { event.preventDefault(); setActionOpen(true); }}><Plus width={12} height={12} /> Add action</button>
        )}
        {editable && showAction && (
          <div className="lesson-callout__action-editor" contentEditable={false}>
            <NodeTextInput className="lesson-callout__action-input" value={actionLabel} placeholder="Action label" onCommit={(value) => updateAttributes({ actionLabel: value })} />
            <NodeTextInput className="lesson-callout__action-input" value={actionUrl} placeholder="https://... or /course/path" onCommit={(value) => updateAttributes({ actionUrl: value })} />
            <button type="button" className="lesson-callout__remove-action" aria-label="Remove action" title="Remove action" onMouseDown={(event) => { event.preventDefault(); removeAction(); }}><X width={12} height={12} /></button>
          </div>
        )}
        {!editable && actionLabel && safeUrl && (
          <a className="lesson-callout__action" href={safeUrl} target={safeUrl.startsWith('/') ? undefined : '_blank'} rel={safeUrl.startsWith('/') ? undefined : 'noopener noreferrer'}>
            {actionLabel}<ArrowUpRight width={13} height={13} />
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
