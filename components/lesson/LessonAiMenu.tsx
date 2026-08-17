'use client';

// Inline "Ask AI" assistant for the TipTap lesson editor. Shows an "Ask AI" trigger over a
// non-empty text selection and opens the shared AiAssistPanel. Results apply through the
// editor's own commands, so the change flows through LessonEditor.onUpdate -> onChange like
// any normal edit (no skipNextSync fight).
//
// Positions the trigger from the selection's own viewport coords (editor.view.coordsAtPos) +
// a portal -- the same dependency-free pattern as RichTextAiMenu / StyleControls, so we avoid
// TipTap's BubbleMenu (which pulls in @floating-ui/dom). LessonEditor is authoring-only (the
// player is LessonRenderer), so this never renders for students. Full action set incl.
// "Make interactive" (knowledge-check node).

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { Wand2 } from 'lucide-react';
import type { JSONContent } from '@tiptap/core';
import { AiAssistPanel, type ApplyMode } from '@/components/AiAssistPanel';
import {
  askAi, textToParagraphNodes, TEXT_ACTIONS, INTERACTIVE_ACTIONS,
  type AiAction, type AiResult,
} from '@/lib/ai-assist';
import { buildLessonNodes } from '@/lib/lesson-blocks';

const ACTIONS = [...TEXT_ACTIONS, ...INTERACTIVE_ACTIONS];

interface Captured { from: number; to: number; text: string; contextText: string; }

export function LessonAiMenu({ editor, dark }: { editor: Editor; dark: boolean }) {
  const [trigger, setTrigger] = useState<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const sel = useRef<Captured | null>(null);

  // The active selection range, or null when the bubble should not show.
  const activeRange = useCallback((): { from: number; to: number } | null => {
    if (!editor.isEditable) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) return null;
    if (editor.isActive('runnableCode') || editor.isActive('knowledgeCheck')) return null;
    if (!editor.state.doc.textBetween(from, to, '\n').trim()) return null;
    return { from, to };
  }, [editor]);

  // Show / position the floating trigger as the selection changes (and on scroll/resize).
  useEffect(() => {
    const sync = () => {
      if (open) return;
      const range = activeRange();
      if (!range) { setTrigger(null); return; }
      let start: { top: number; bottom: number; left: number };
      let end: { top: number; bottom: number };
      try {
        start = editor.view.coordsAtPos(range.from);
        end = editor.view.coordsAtPos(range.to);
      } catch { setTrigger(null); return; }
      const topEdge = Math.min(start.top, end.top);
      const top = topEdge > 46 ? topEdge - 38 : Math.max(start.bottom, end.bottom) + 8;
      const left = Math.max(8, Math.min(start.left, window.innerWidth - 96));
      setTrigger({ top, left });
    };
    sync();
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [editor, open, activeRange]);

  // Freeze the range + plain text synchronously before any await; focus may leave the
  // editor once the panel input is used, but these offsets stay valid.
  const onTrigger = (e: React.MouseEvent) => {
    e.preventDefault();
    const range = activeRange();
    if (!range) return;
    const { from, to } = range;
    const size = editor.state.doc.content.size;
    sel.current = {
      from, to,
      text: editor.state.doc.textBetween(from, to, '\n'),
      contextText: editor.state.doc.textBetween(Math.max(0, from - 600), Math.min(size, to + 600), '\n'),
    };
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    setOpen(true);
  };

  const onRun = useCallback(async (action: AiAction, instruction: string): Promise<AiResult> => {
    const s = sel.current;
    if (!s) throw new Error('Selection lost. Select the text again.');
    // Only this surface can hold interactive nodes, so only it lets a free instruction
    // ("turn this into three tabs") come back as blocks instead of a rewrite.
    return askAi({ action, text: s.text, instruction, contextText: s.contextText, allowBlocks: true });
  }, []);

  const onApply = useCallback((mode: ApplyMode, result: AiResult) => {
    const s = sel.current;
    if (!s) return;
    if (result.kind === 'blocks') {
      // Interactive blocks are inserted after the selection (the source text is kept).
      const nodes = buildLessonNodes(result.blocks) as JSONContent[];
      if (nodes.length) editor.chain().focus().insertContentAt(s.to, nodes).run();
      return;
    }
    const nodes = textToParagraphNodes(result.text);
    if (mode === 'replace') {
      editor.chain().focus().insertContentAt({ from: s.from, to: s.to }, nodes).run();
    } else {
      editor.chain().focus().insertContentAt(s.to, nodes).run();
    }
  }, [editor]);

  const close = () => { setOpen(false); setTrigger(null); };

  return (
    <>
      {trigger && !open && createPortal(
        <button
          type="button"
          onMouseDown={onTrigger}
          style={{
            position: 'fixed', top: trigger.top, left: trigger.left, zIndex: 9998,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            color: dark ? '#e8e8ea' : '#1a1a1a', background: dark ? '#2a2b2f' : '#ffffff',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'}`,
            boxShadow: dark ? '0 4px 16px rgba(0,0,0,0.45)' : '0 4px 16px rgba(0,0,0,0.14)',
            cursor: 'pointer',
          }}
        >
          <Wand2 width={14} height={14} color="#10b981" />
          Ask AI
        </button>,
        document.body,
      )}

      {open && anchor && (
        <AiAssistPanel
          anchor={anchor}
          actions={ACTIONS}
          dark={dark}
          onRun={onRun}
          onApply={onApply}
          onClose={close}
        />
      )}
    </>
  );
}
