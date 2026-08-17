'use client';

// Shared UI for the inline "Ask AI" assistant. Editor-agnostic: the TipTap and
// contentEditable adapters open it with an anchor rect, an action list, an onRun
// (which carries the captured selection), and apply callbacks. Presentational +
// its own phase state only -- it never touches an editor directly.
//
// Portaled to <body> and positioned with the same getBoundingClientRect + position:fixed
// approach as components/lesson/nodes/StyleControls.tsx (native CSS anchor positioning is
// not broadly supported yet). Accent is the editor-chrome green (#10b981); no purple/indigo.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Wand2, Expand, Minimize2, SpellCheck, Sparkles, Briefcase, PenLine,
  AlignLeft, HelpCircle, Send, Loader2, Check, X,
  Info, Layers, ListChecks, ChevronsUpDown, LayoutGrid, GalleryHorizontal, History,
  PanelsTopLeft, MessageSquareCode, Terminal, Braces, Table,
} from 'lucide-react';
import type { AiAction, AiActionDef, AiResult } from '@/lib/ai-assist';
import { blockLabel, type AiBlock } from '@/lib/lesson-blocks';

export type ApplyMode = 'replace' | 'insertBelow';

interface AiAssistPanelProps {
  anchor: { top: number; bottom: number; left: number; right: number };
  actions: AiActionDef[];
  dark: boolean;
  onRun: (action: AiAction, instruction: string) => Promise<AiResult>;
  onApply: (mode: ApplyMode, result: AiResult) => void;
  onClose: () => void;
}

type Phase =
  | { kind: 'menu' }
  | { kind: 'loading' }
  | { kind: 'preview'; result: AiResult; action: AiAction }
  | { kind: 'error'; message: string };

const ACTION_ICONS: Record<AiAction, React.ComponentType<{ width?: number; height?: number }>> = {
  improve: Wand2,
  expand: Expand,
  summarize: AlignLeft,
  shorten: Minimize2,
  grammar: SpellCheck,
  simplify: Sparkles,
  formal: Briefcase,
  continue: PenLine,
  custom: Wand2,
  // Icons match components/lesson/InteractiveInsertMenu, so an element looks the same
  // whether it is inserted by hand or asked for.
  make_auto: Sparkles,
  make_callout: Info,
  make_knowledgeCheck: HelpCircle,
  make_flipCards: Layers,
  make_stepCards: PanelsTopLeft,
  make_guidedSteps: ListChecks,
  make_accordion: ChevronsUpDown,
  make_tabs: LayoutGrid,
  make_carousel: GalleryHorizontal,
  make_timeline: History,
  make_table: Table,
  make_promptBlock: MessageSquareCode,
  make_sql: Terminal,
  make_python: Braces,
};

const PANEL_WIDTH = 300;

export function AiAssistPanel({ anchor, actions, dark, onRun, onApply, onClose }: AiAssistPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'menu' });
  const [instruction, setInstruction] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: anchor.bottom + 6,
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - 8)),
  }));
  const panelRef = useRef<HTMLDivElement>(null);
  const lastRun = useRef<{ action: AiAction; instruction: string } | null>(null);

  const palette = dark
    ? { bg: '#1f2023', panel: '#26272b', text: '#e8e8ea', sub: '#9aa0a6', border: 'rgba(255,255,255,0.10)', hover: 'rgba(255,255,255,0.06)', field: 'rgba(255,255,255,0.05)' }
    : { bg: '#ffffff', panel: '#ffffff', text: '#1a1a1a', sub: '#666', border: 'rgba(0,0,0,0.08)', hover: 'rgba(0,0,0,0.045)', field: '#f4f5f7' };
  const GREEN = '#10b981';

  // Flip above / clamp inside the viewport once the real panel size is known.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight - 8) {
      const above = anchor.top - h - 6;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - h - 8);
    }
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [anchor, phase]);

  // Close on outside mousedown / Escape. Panel is position:fixed so scrolling just
  // detaches it visually -- not closing on scroll preserves a generated preview.
  // Attach on the next tick so the SAME mousedown that opened the panel (on the trigger,
  // which lives outside this panel) cannot immediately close it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function run(action: AiAction, instr: string) {
    lastRun.current = { action, instruction: instr };
    setPhase({ kind: 'loading' });
    try {
      const result = await onRun(action, instr);
      setPhase({ kind: 'preview', result, action });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message || 'Something went wrong.' });
    }
  }

  function regenerate() {
    if (lastRun.current) run(lastRun.current.action, lastRun.current.instruction);
  }

  function apply(mode: ApplyMode, result: AiResult) {
    onApply(mode, result);
    onClose();
  }

  // Shared button styles
  const primaryBtn: React.CSSProperties = { background: GREEN, color: '#fff', border: 'none' };
  const ghostBtn: React.CSSProperties = { background: palette.field, color: palette.text, border: 'none' };

  return createPortal(
    <div
      ref={panelRef}
      className="ai-assist-panel"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: PANEL_WIDTH,
        maxWidth: 'calc(100vw - 16px)',
        background: palette.panel,
        color: palette.text,
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        boxShadow: dark ? '0 10px 40px rgba(0,0,0,0.5)' : '0 10px 40px rgba(0,0,0,0.16)',
        zIndex: 9999,
        overflow: 'hidden',
        fontSize: 13,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderBottom: `1px solid ${palette.border}` }}>
        <Wand2 width={14} height={14} />
        <span style={{ fontWeight: 600, fontSize: 12.5, letterSpacing: '-0.01em' }}>Ask AI</span>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onClose(); }}
          aria-label="Close" style={{ marginLeft: 'auto', color: palette.sub, lineHeight: 0 }}>
          <X width={15} height={15} />
        </button>
      </div>

      {phase.kind === 'menu' && (
        <div>
          <div style={{ padding: 5, maxHeight: 320, overflowY: 'auto' }}>
            {actions.map(({ action, label, group }, i) => {
              const Icon = ACTION_ICONS[action];
              const showHeader = group === 'interactive' && (i === 0 || actions[i - 1].group !== 'interactive');
              return (
                <Fragment key={action}>
                  {showHeader && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.sub, padding: '9px 9px 4px', marginTop: 3, borderTop: `1px solid ${palette.border}` }}>
                      Make interactive
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); run(action, ''); }}
                    className="ai-assist-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                      padding: '8px 9px', borderRadius: 7, color: palette.text, textAlign: 'left',
                    }}
                  >
                    <Icon width={15} height={15} />
                    <span>{label}</span>
                  </button>
                </Fragment>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderTop: `1px solid ${palette.border}` }}>
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && instruction.trim()) { e.preventDefault(); run('custom', instruction.trim()); } }}
              placeholder="Ask AI to..."
              style={{
                flex: 1, background: palette.field, color: palette.text, border: 'none',
                borderRadius: 7, padding: '7px 10px', fontSize: 13, outline: 'none',
              }}
            />
            <button
              type="button"
              disabled={!instruction.trim()}
              onMouseDown={(e) => { e.preventDefault(); if (instruction.trim()) run('custom', instruction.trim()); }}
              aria-label="Send"
              style={{ ...primaryBtn, opacity: instruction.trim() ? 1 : 0.45, borderRadius: 7, padding: 7, lineHeight: 0 }}
            >
              <Send width={14} height={14} />
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '18px 14px', color: palette.sub }}>
          <Loader2 width={16} height={16} className="animate-spin" />
          <span>Generating...</span>
        </div>
      )}

      {phase.kind === 'error' && (
        <div style={{ padding: '12px 14px' }}>
          <p style={{ color: '#e5484d', fontSize: 12.5, margin: '0 0 10px' }}>{phase.message}</p>
          <div style={{ display: 'flex', gap: 7 }}>
            <PanelBtn style={primaryBtn} onClick={regenerate}>Try again</PanelBtn>
            <PanelBtn style={ghostBtn} onClick={onClose}>Discard</PanelBtn>
          </div>
        </div>
      )}

      {phase.kind === 'preview' && phase.result.kind === 'text' && (
        <div style={{ padding: '10px 12px' }}>
          <div
            style={{
              maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap',
              background: palette.field, borderRadius: 8, padding: '9px 11px',
              fontSize: 13, lineHeight: 1.5, marginBottom: 10,
            }}
          >
            {phase.result.text}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {phase.action !== 'continue' && (
              <PanelBtn style={primaryBtn} onClick={() => apply('replace', phase.result)}>
                <Check width={13} height={13} /> Replace
              </PanelBtn>
            )}
            <PanelBtn style={phase.action === 'continue' ? primaryBtn : ghostBtn} onClick={() => apply('insertBelow', phase.result)}>
              Insert below
            </PanelBtn>
            <PanelBtn style={ghostBtn} onClick={regenerate}>Regenerate</PanelBtn>
            <PanelBtn style={ghostBtn} onClick={onClose}>Discard</PanelBtn>
          </div>
        </div>
      )}

      {phase.kind === 'preview' && phase.result.kind === 'blocks' && (
        <div style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.sub, marginBottom: 6 }}>
            {phase.result.blocks.length === 1 ? blockLabel(phase.result.blocks[0]?.type) : `${phase.result.blocks.length} blocks`}
          </div>
          <div style={{ maxHeight: 230, overflowY: 'auto', background: palette.field, borderRadius: 8, padding: '10px 11px', marginBottom: 10 }}>
            <BlockPreview blocks={phase.result.blocks} sub={palette.sub} green={GREEN} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <PanelBtn style={primaryBtn} onClick={() => apply('insertBelow', phase.result)}>
              <Check width={13} height={13} /> Insert
            </PanelBtn>
            <PanelBtn style={ghostBtn} onClick={regenerate}>Regenerate</PanelBtn>
            <PanelBtn style={ghostBtn} onClick={onClose}>Discard</PanelBtn>
          </div>
        </div>
      )}

      <style>{`
        .ai-assist-panel .ai-assist-row { transition: background 0.12s; }
        .ai-assist-panel .ai-assist-row:hover { background: ${palette.hover}; }
      `}</style>
    </div>,
    document.body,
  );
}

function PanelBtn({ style, onClick, children }: { style: React.CSSProperties; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '7px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
        cursor: 'pointer', ...style,
      }}
    >
      {children}
    </button>
  );
}

// Read-only outline of a generated block tree. One renderer for every block type, and it
// recurses through nested sections, so a tabs block holding a knowledge check previews as
// what it is instead of needing a hand-written case per format.
function BlockPreview({ blocks, sub, green, depth = 0 }: { blocks: AiBlock[]; sub: string; green: string; depth?: number }) {
  const title: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, margin: '0 0 2px' };
  const bodyText: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, margin: 0, whiteSpace: 'pre-wrap' };
  const muted: React.CSSProperties = { fontSize: 11.5, color: sub, margin: 0 };
  const eyebrow: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: sub, margin: '0 0 3px' };
  const stack: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9 };

  return (
    <ul style={stack}>
      {blocks.map((b, i) => {
        const heading = b.title || b.question || '';
        const parts = Array.isArray(b.parts) ? b.parts : [];
        const items = Array.isArray(b.items) ? b.items : [];
        const options = Array.isArray(b.options) ? b.options : [];
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const children = Array.isArray(b.children) ? b.children : [];
        return (
          <li key={i}>
            {depth === 0 && blocks.length > 1 && <p style={eyebrow}>{blockLabel(b.type)}</p>}
            {heading && <p style={title}>{heading}</p>}
            {b.text && <p style={bodyText}>{b.text}</p>}

            {options.length > 0 && (
              <ul style={{ ...stack, gap: 5, marginTop: 6 }}>
                {options.map((opt, o) => {
                  const correct = o === Number(b.correctIndex ?? 0);
                  return (
                    <li key={o} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: correct ? green : 'inherit' }}>
                      {correct ? <Check width={13} height={13} /> : <span style={{ width: 13, display: 'inline-block' }} />}
                      <span>{opt}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            {items.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                {items.map((item, n) => <li key={n} style={bodyText}>{item}</li>)}
              </ul>
            )}

            {(b.code || b.prompt) && (
              <pre style={{ ...bodyText, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, margin: '4px 0 0', overflowX: 'auto' }}>
                {b.code || b.prompt}
              </pre>
            )}

            {rows.length > 0 && (
              <ul style={{ ...stack, gap: 3, marginTop: 4 }}>
                {rows.map((row, r) => (
                  <li key={r} style={{ ...bodyText, color: r === 0 ? undefined : sub }}>
                    {(row?.cells ?? []).join('  |  ')}
                  </li>
                ))}
              </ul>
            )}

            {parts.length > 0 && (
              <ul style={{ ...stack, marginTop: 6, paddingLeft: 9, borderLeft: `1px solid ${sub}33` }}>
                {parts.map((p, n) => {
                  const label = [p.date, p.title || p.label || p.front].filter(Boolean).join(' - ');
                  const nested = Array.isArray(p.children) ? p.children : [];
                  return (
                    <li key={n}>
                      <p style={title}>{label || `Item ${n + 1}`}</p>
                      {(p.body || p.back) && <p style={bodyText}>{p.body || p.back}</p>}
                      {nested.length > 0 && (
                        <div style={{ marginTop: 5 }}>
                          <BlockPreview blocks={nested} sub={sub} green={green} depth={depth + 1} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {children.length > 0 && (
              <div style={{ marginTop: 5 }}>
                <BlockPreview blocks={children} sub={sub} green={green} depth={depth + 1} />
              </div>
            )}

            {b.explanation && <p style={{ ...muted, marginTop: 8, lineHeight: 1.45 }}>{b.explanation}</p>}
          </li>
        );
      })}
    </ul>
  );
}
