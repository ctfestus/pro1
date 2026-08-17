// Client-side contract + helpers for the inline "Ask AI" assistant.
// Shared by the TipTap adapter (components/lesson/LessonAiMenu) and the contentEditable
// adapter (components/RichTextAiMenu). Pure logic only -- no rendering.

import type { JSONContent } from '@tiptap/core';
import { supabase } from '@/lib/supabase';
import type { AiBlock } from '@/lib/lesson-blocks';

export type AiAction =
  // text transforms (every surface)
  | 'improve' | 'expand' | 'summarize' | 'shorten'
  | 'grammar' | 'simplify' | 'formal' | 'continue' | 'custom'
  // interactive-block generators (lesson editor only) -- one per element in the editor's
  // insert menu that an AI can author, so the menu and the assistant stay in step.
  | 'make_auto' | 'make_callout' | 'make_knowledgeCheck' | 'make_flipCards'
  | 'make_stepCards' | 'make_guidedSteps' | 'make_accordion' | 'make_tabs'
  | 'make_carousel' | 'make_timeline' | 'make_table' | 'make_promptBlock'
  | 'make_sql' | 'make_python';

export interface AiActionDef {
  action: AiAction;
  label: string;
  group: 'text' | 'interactive';
}

// Quick text transforms, offered on every surface.
export const TEXT_ACTIONS: AiActionDef[] = [
  { action: 'improve',   label: 'Improve writing', group: 'text' },
  { action: 'expand',    label: 'Expand', group: 'text' },
  { action: 'summarize', label: 'Summarize', group: 'text' },
  { action: 'shorten',   label: 'Make shorter', group: 'text' },
  { action: 'grammar',   label: 'Fix spelling and grammar', group: 'text' },
  { action: 'simplify',  label: 'Simplify', group: 'text' },
  { action: 'formal',    label: 'More formal', group: 'text' },
  { action: 'continue',  label: 'Continue writing', group: 'text' },
];

// Offered only where interactive blocks have a runtime (the TipTap lesson editor).
// Labels mirror components/lesson/InteractiveInsertMenu so the same element is called the
// same thing whether the author inserts it by hand or asks the AI for it. "Suggest best
// format" lets the model read the selection and pick.
export const INTERACTIVE_ACTIONS: AiActionDef[] = [
  { action: 'make_auto',           label: 'Suggest best format', group: 'interactive' },
  { action: 'make_callout',        label: 'Callout', group: 'interactive' },
  { action: 'make_knowledgeCheck', label: 'Knowledge check', group: 'interactive' },
  { action: 'make_flipCards',      label: 'Flip cards', group: 'interactive' },
  { action: 'make_stepCards',      label: 'Step cards', group: 'interactive' },
  { action: 'make_guidedSteps',    label: 'Guided steps', group: 'interactive' },
  { action: 'make_accordion',      label: 'Collapsible sections', group: 'interactive' },
  { action: 'make_tabs',           label: 'Tabs', group: 'interactive' },
  { action: 'make_carousel',       label: 'Carousel', group: 'interactive' },
  { action: 'make_timeline',       label: 'Timeline', group: 'interactive' },
  { action: 'make_table',          label: 'Table', group: 'interactive' },
  { action: 'make_promptBlock',    label: 'AI prompt', group: 'interactive' },
  { action: 'make_sql',            label: 'SQL playground', group: 'interactive' },
  { action: 'make_python',         label: 'Python playground', group: 'interactive' },
];

/**
 * A result is either rewritten prose or a tree of lesson blocks (lib/lesson-blocks), which
 * the caller converts with buildLessonNodes. Blocks come back from every "make_" action and
 * from a free instruction that asked for structure rather than a rewrite.
 */
export type AiResult =
  | { kind: 'text'; text: string }
  | { kind: 'blocks'; blocks: AiBlock[] };

export interface AskAiInput {
  action: AiAction;
  text: string;
  instruction?: string;
  contextText?: string;
  /** Set by surfaces that can hold interactive blocks -- only the lesson editor. */
  allowBlocks?: boolean;
}

/** Call the instructor-only /api/ai-assist route. Throws Error(message) on failure. */
export async function askAi(input: AskAiInput): Promise<AiResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/ai-assist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'AI request failed.');
  if (data?.kind === 'blocks' && Array.isArray(data.blocks)) {
    return { kind: 'blocks', blocks: data.blocks as AiBlock[] };
  }
  return { kind: 'text', text: String(data?.result ?? '') };
}

/**
 * Plain text -> TipTap content nodes. Blank lines separate paragraphs; single
 * newlines become hard breaks. For insertContentAt in the lesson editor.
 */
export function textToParagraphNodes(text: string): JSONContent[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      const content: JSONContent[] = [];
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (line) content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content: content.length ? content : undefined };
    });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text -> sanitized HTML paragraphs (block). For inserting a new block in RichTextEditor. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Plain text -> inline HTML (text + <br>, no block <p>). Use when replacing an INLINE
 * selection inside an existing block, so we never nest a <p> inside a paragraph / span /
 * list item and split the markup.
 */
export function textToInlineHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n/g, '\n')).replace(/\n/g, '<br>');
}
