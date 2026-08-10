'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  Blocks, BookOpenCheck, Braces, ChevronsUpDown, ChevronDown, GalleryHorizontal,
  HelpCircle, History, Info, Layers, LayoutGrid, ListChecks, MessageSquareCode,
  PanelsTopLeft, Search, Terminal,
} from 'lucide-react';
import { insertStepCards } from '@/lib/lesson-step-cards';

type InsertCategory = 'Organize' | 'Engage' | 'Practice';

interface InsertItem {
  id: string;
  label: string;
  description: string;
  category: InsertCategory;
  Icon: ComponentType<{ width?: number; height?: number; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  content?: Record<string, unknown>;
  action?: (editor: Editor) => void;
}

const ITEMS: InsertItem[] = [
  { id: 'accordion', label: 'Collapsible sections', description: 'Reveal supporting details on demand.', category: 'Organize', Icon: ChevronsUpDown, content: { type: 'accordion', content: [{ type: 'accordionItem', attrs: { title: '', open: false }, content: [{ type: 'paragraph' }] }] } },
  { id: 'tabs', label: 'Tabs', description: 'Organize related content into focused views.', category: 'Organize', Icon: LayoutGrid, content: { type: 'tabs', content: [{ type: 'tabPanel', attrs: { label: 'Tab 1' }, content: [{ type: 'paragraph' }] }, { type: 'tabPanel', attrs: { label: 'Tab 2' }, content: [{ type: 'paragraph' }] }] } },
  { id: 'carousel', label: 'Carousel', description: 'Guide learners through a sequence of slides.', category: 'Organize', Icon: GalleryHorizontal, content: { type: 'carousel', content: [{ type: 'carouselSlide', content: [{ type: 'paragraph' }] }, { type: 'carouselSlide', content: [{ type: 'paragraph' }] }] } },
  { id: 'step-cards', label: 'Step cards', description: 'Show scan-friendly numbered instructions.', category: 'Organize', Icon: PanelsTopLeft, action: insertStepCards },
  { id: 'guided-steps', label: 'Guided steps', description: 'Reveal a process one step at a time.', category: 'Organize', Icon: ListChecks, content: { type: 'stepper', content: [{ type: 'step', attrs: { title: '' }, content: [{ type: 'paragraph' }] }, { type: 'step', attrs: { title: '' }, content: [{ type: 'paragraph' }] }] } },
  { id: 'timeline', label: 'Timeline', description: 'Present milestones in chronological order.', category: 'Organize', Icon: History, content: { type: 'timeline', content: [{ type: 'timelineEntry', attrs: { date: '', title: '' }, content: [{ type: 'paragraph' }] }, { type: 'timelineEntry', attrs: { date: '', title: '' }, content: [{ type: 'paragraph' }] }] } },
  { id: 'callout', label: 'Callout', description: 'Highlight a note, tip, warning, or insight.', category: 'Engage', Icon: Info, content: { type: 'callout', attrs: { variant: 'note' }, content: [{ type: 'paragraph' }] } },
  { id: 'flip-cards', label: 'Flip cards', description: 'Create tap-to-reveal terms and answers.', category: 'Engage', Icon: Layers, content: { type: 'flipCardDeck', content: [{ type: 'flipCard', attrs: { front: '', back: '' } }, { type: 'flipCard', attrs: { front: '', back: '' } }] } },
  { id: 'prompt', label: 'AI prompt', description: 'Let learners copy or launch a prepared prompt.', category: 'Engage', Icon: MessageSquareCode, content: { type: 'promptBlock', attrs: { title: 'Try this prompt', prompt: '', showChatGpt: true, showClaude: true } } },
  { id: 'knowledge-check', label: 'Knowledge check', description: 'Add instant, ungraded multiple-choice practice.', category: 'Practice', Icon: HelpCircle, content: { type: 'knowledgeCheck', attrs: { question: '', options: ['', ''], correctIndex: 0, explanation: '' } } },
  { id: 'sql', label: 'SQL playground', description: 'Add executable SQL with optional sample data.', category: 'Practice', Icon: Terminal, content: { type: 'runnableCode', attrs: { language: 'sql', code: '', setupSql: '', setupPython: '' } } },
  { id: 'python', label: 'Python playground', description: 'Add executable Python directly in the lesson.', category: 'Practice', Icon: Braces, content: { type: 'runnableCode', attrs: { language: 'python', code: '', setupSql: '', setupPython: '' } } },
];

const CATEGORY_META: Record<InsertCategory, { label: string; Icon: typeof Blocks }> = {
  Organize: { label: 'Organize content', Icon: Blocks },
  Engage: { label: 'Engage learners', Icon: BookOpenCheck },
  Practice: { label: 'Practice & apply', Icon: HelpCircle },
};

function insertAtSelectionOrEnd(editor: Editor, content: Record<string, unknown>) {
  const inserted = editor.chain().focus().insertContent(content).run();
  if (!inserted) editor.chain().focus().insertContentAt(editor.state.doc.content.size, content).run();
}

export function InteractiveInsertMenu({ editor, dark, accentColor }: { editor: Editor; dark: boolean; accentColor: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? ITEMS.filter((item) => `${item.label} ${item.description} ${item.category}`.toLowerCase().includes(needle))
      : ITEMS;
  }, [query]);

  const grouped = useMemo(() => (['Organize', 'Engage', 'Practice'] as InsertCategory[])
    .map((category) => ({ category, items: filtered.filter((item) => item.category === category) }))
    .filter((group) => group.items.length > 0), [filtered]);

  const measurePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const gap = 8;
    const availableBelow = window.innerHeight - rect.bottom - gap;
    const availableAbove = rect.top - gap;
    const openAbove = availableBelow < 320 && availableAbove > availableBelow;
    const available = Math.max(220, openAbove ? availableAbove : availableBelow);
    const maxHeight = Math.min(560, available);
    return {
      top: openAbove ? Math.max(gap, rect.top - gap - maxHeight) : rect.bottom + gap,
      left: Math.max(gap, Math.min(rect.left, window.innerWidth - 376)),
      maxHeight,
    };
  };

  useEffect(() => {
    if (!open) return;
    const focusId = window.requestAnimationFrame(() => searchRef.current?.focus());
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const reposition = (event?: Event) => {
      const target = event?.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      const next = measurePosition();
      if (!next) return;
      setPosition((current) => current?.top === next.top && current.left === next.left && current.maxHeight === next.maxHeight ? current : next);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setPosition(measurePosition());
    setQuery('');
    setOpen(true);
  };

  const insert = (item: InsertItem) => {
    if (item.action) item.action(editor);
    else if (item.content) insertAtSelectionOrEnd(editor, item.content);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lesson-insert-trigger"
        data-open={open ? 'true' : 'false'}
        data-theme={dark ? 'dark' : 'light'}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ '--insert-accent': accentColor } as React.CSSProperties}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        <Blocks width={14} height={14} aria-hidden="true" />
        <span>Add interactive</span>
        <ChevronDown width={13} height={13} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <div
          ref={panelRef}
          className={`lesson-insert-menu ${dark ? 'dark' : ''}`}
          style={{ position: 'fixed', top: position.top, left: position.left, maxHeight: position.maxHeight, '--insert-accent': accentColor } as React.CSSProperties}
          role="dialog"
          aria-label="Add interactive content"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="lesson-insert-menu__header">
            <div>
              <strong>Add interactive content</strong>
              <span>Choose a learning experience</span>
            </div>
          </div>
          <label className="lesson-insert-menu__search">
            <Search width={14} height={14} aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search interactions..." aria-label="Search interactive content" />
          </label>
          <div className="lesson-insert-menu__results">
            {grouped.map(({ category, items }) => {
              const MetaIcon = CATEGORY_META[category].Icon;
              return (
                <section key={category} className="lesson-insert-menu__group">
                  <div className="lesson-insert-menu__group-label"><MetaIcon width={12} height={12} aria-hidden="true" /> {CATEGORY_META[category].label}</div>
                  <div className="lesson-insert-menu__grid">
                    {items.map((item) => {
                      const ItemIcon = item.Icon;
                      return (
                        <button key={item.id} type="button" className="lesson-insert-menu__item" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(item)}>
                          <span className="lesson-insert-menu__icon"><ItemIcon width={17} height={17} aria-hidden="true" /></span>
                          <span className="lesson-insert-menu__copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {filtered.length === 0 && <div className="lesson-insert-menu__empty">No interactive elements match &quot;{query}&quot;.</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
