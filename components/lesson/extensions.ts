// Shared TipTap node/extension set for interactive lessons.
//
// This is the single source of truth imported by BOTH the authoring editor
// (components/lesson/LessonEditor) and the read-only player renderer
// (components/lesson/LessonRenderer). Defining the schema once is what keeps the
// editor and the renderer from drifting -- a node that exists in one but not the
// other would either fail to author or fail to display.
//
// Custom interactive nodes (callout, accordion, tabs, knowledge check, runnable
// code) are appended to `lessonExtensions` in later phases so both surfaces gain
// them at the same time.

import { generateJSON, mergeAttributes, type Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table, TableView, createColGroup } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import type { DOMOutputSpec, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { LessonDoc } from '@/lib/lesson-doc';
import { LessonImage } from '@/components/lesson/nodes/LessonImage';
import { LessonAudio } from '@/components/lesson/nodes/LessonAudio';
import { LessonAttachment } from '@/components/lesson/nodes/LessonAttachment';
import { Callout } from '@/components/lesson/nodes/Callout';
import { Accordion, AccordionItem } from '@/components/lesson/nodes/Accordion';
import { Tabs, TabPanel } from '@/components/lesson/nodes/Tabs';
import { KnowledgeCheck } from '@/components/lesson/nodes/KnowledgeCheck';
import { RunnableCode } from '@/components/lesson/nodes/RunnableCode';
import { Carousel, CarouselSlide } from '@/components/lesson/nodes/Carousel';
import { FlipCard, FlipCardDeck } from '@/components/lesson/nodes/FlipCards';
import { Stepper, Step } from '@/components/lesson/nodes/Stepper';
import { StepCards, StepCard } from '@/components/lesson/nodes/StepCards';
import { Timeline, TimelineEntry } from '@/components/lesson/nodes/Timeline';
import { GlossaryTerm } from '@/components/lesson/nodes/GlossaryTerm';
import { PromptBlock } from '@/components/lesson/nodes/PromptBlock';

// Border styling lives on the CELLS, not the table. TipTap's resizable Table renders
// through its own TableView, which ignores custom table-level attributes (and the
// editor path overwrites the table style with the column width) -- so table-level
// attrs never reliably reach the DOM, especially in the read-only player. Cell
// renderHTML is reliable in both. cellBorder = which sides show; cellBorderColor = a
// free color via the --cbc CSS var. The table toolbar sets these on every cell.
const cellAppearanceAttrs = {
  cellBorder: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-cb'),
    renderHTML: (attrs: Record<string, unknown>) => (attrs.cellBorder ? { 'data-cb': attrs.cellBorder } : {}),
  },
  cellBorderColor: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-cbc'),
    renderHTML: (attrs: Record<string, unknown>) => (attrs.cellBorderColor
      ? { 'data-cbc': attrs.cellBorderColor, style: `--cbc:${attrs.cellBorderColor}` }
      : {}),
  },
  cellAlign: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-cell-align'),
    renderHTML: (attrs: Record<string, unknown>) => (attrs.cellAlign
      ? { 'data-cell-align': attrs.cellAlign, style: `text-align:${attrs.cellAlign}` }
      : {}),
  },
  cellBackground: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-cell-bg'),
    renderHTML: (attrs: Record<string, unknown>) => (attrs.cellBackground
      ? { 'data-cell-bg': attrs.cellBackground, style: `--cell-bg:${attrs.cellBackground}` }
      : {}),
  },
};
const LessonTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), ...cellAppearanceAttrs }; },
});
const LessonTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), ...cellAppearanceAttrs }; },
});

class LessonTableView extends TableView {
  caption: HTMLTableCaptionElement;
  scrollHint: HTMLDivElement;

  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView) {
    super(node, cellMinWidth);
    this.dom.classList.add('lesson-table-wrap');
    this.caption = document.createElement('caption');
    this.caption.className = 'lesson-table-caption';
    this.caption.contentEditable = 'false';
    this.table.insertBefore(this.caption, this.colgroup);
    this.scrollHint = document.createElement('div');
    this.scrollHint.className = 'lesson-table-scroll-hint';
    this.scrollHint.contentEditable = 'false';
    this.scrollHint.dataset.editor = view?.editable ? 'true' : 'false';
    this.scrollHint.innerHTML = '<span></span>Swipe to view more';
    this.dom.appendChild(this.scrollHint);
    this.syncCaption(node);
  }

  syncCaption(node: ProseMirrorNode) {
    const text = (node.attrs.caption as string) || '';
    this.caption.textContent = text;
    this.caption.hidden = !text;
    this.dom.dataset.tableRadius = (node.attrs.radius as string) || 'square';
  }

  update(node: ProseMirrorNode) {
    const updated = super.update(node);
    if (updated) this.syncCaption(node);
    return updated;
  }
}

const LessonTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: (element: HTMLElement) => element.querySelector(':scope > caption')?.textContent || '',
        renderHTML: () => ({}),
      },
      radius: {
        default: 'square',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-table-radius') || 'square',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-table-radius': attrs.radius || 'square' }),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth);
    const userStyles = HTMLAttributes.style as string | undefined;
    const caption = (node.attrs.caption as string) || '';
    const table: DOMOutputSpec = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style: userStyles || (tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}`) }),
      ...(caption ? [['caption', { class: 'lesson-table-caption' }, caption] as DOMOutputSpec] : []),
      colgroup,
      ['tbody', 0],
    ];
    return ['div', { class: 'tableWrapper lesson-table-wrap', 'data-table-radius': (node.attrs.radius as string) || 'square' }, table];
  },
});

export const lessonExtensions: Extensions = [
  // StarterKit (3.23.x) bundles document/paragraph/text, headings, bullet/ordered
  // lists, bold/italic/strike, inline code, code block, blockquote, horizontal rule,
  // hard break, link, underline, and history. Do NOT also register link/underline
  // separately -- TipTap throws on duplicate extension names.
  StarterKit,
  // URL-only images (with align/size/caption/border controls); base64 is rejected so
  // large image data never lands inside the questions JSONB.
  LessonImage.configure({ inline: false, allowBase64: false }),
  // Audio player block (uploaded Cloudinary file or pasted direct URL).
  LessonAudio,
  // Downloadable file block (uploaded to Supabase Storage or pasted direct URL).
  LessonAttachment,
  LessonTable.configure({ resizable: true, View: LessonTableView }),
  TableRow,
  LessonTableHeader,
  LessonTableCell,
  Callout,
  Accordion,
  AccordionItem,
  Tabs,
  TabPanel,
  KnowledgeCheck,
  RunnableCode,
  Carousel,
  CarouselSlide,
  FlipCardDeck,
  FlipCard,
  Stepper,
  Step,
  StepCards,
  StepCard,
  Timeline,
  TimelineEntry,
  GlossaryTerm,
  PromptBlock,
];

/**
 * Build a canonical lesson doc from an HTML string (e.g. AI-generated lesson body),
 * so the lesson stays doc-canonical instead of falling back to body-only. Uses the
 * shared extensions as the parse schema; HTML that does not map to a node (rare) is
 * dropped per ProseMirror parsing rules. Requires a DOM (call client-side / runtime).
 */
export function lessonHtmlToDoc(html: string): LessonDoc {
  return generateJSON(html, lessonExtensions) as LessonDoc;
}
