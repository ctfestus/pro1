// Contract for AI-authored interactive lesson blocks.
//
// One shape, shared by every AI surface that writes into a lesson: the course/document
// generators (app/api/ai-course) and the inline "Ask AI" assistant (app/api/ai-assist ->
// components/lesson/LessonAiMenu). Before this existed each surface had its own private
// list of block types, so a node added to components/lesson/nodes/* was invisible to the
// AI until every list was updated by hand -- which is exactly how they drifted.
//
// The model returns a tree of `AiBlock`, and `buildLessonNodes` turns it into the
// ProseMirror/TipTap JSON that lesson.doc stores. Containers carry their sections in
// `parts`; a part holds either plain `body` text or nested `children` blocks, which is
// what lets the AI put a callout inside a tab or a knowledge check inside a step.
//
// DEPENDENCY-FREE (no TipTap, no @google/genai) so the server routes and the client
// editor can both import it. The Gemini schema + prompt guide live in lib/lesson-blocks-ai.

import type { LessonDoc } from '@/lib/lesson-doc';

/** One section of a container block (a tab, a slide, a step, an accordion section, a card). */
export interface AiBlockPart {
  /** tabs */
  label?: string;
  /** accordion, carousel, stepCards, guidedSteps */
  title?: string;
  /** timeline */
  date?: string;
  /** flipCards */
  front?: string;
  back?: string;
  /** Plain-text body, used when `children` is absent. */
  body?: string;
  /** Nested blocks, so a section can hold any other block type. */
  children?: AiBlock[];
}

export interface AiBlock {
  type?: string;
  text?: string;
  level?: number;
  items?: string[];
  variant?: string;
  title?: string;
  question?: string;
  format?: string;
  options?: string[];
  correctIndex?: number;
  acceptedAnswers?: string[];
  expectedAnswer?: string;
  explanation?: string;
  language?: string;
  code?: string;
  setupSql?: string;
  setupPython?: string;
  prompt?: string;
  rows?: { cells?: string[] }[];
  parts?: AiBlockPart[];
  children?: AiBlock[];
}

/** Block types the AI may produce. Image, audio, and attachment need a real file, so they are out. */
export const AI_BLOCK_TYPES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'table',
  'callout', 'knowledgeCheck', 'runnableCode', 'promptBlock',
  'flipCards', 'accordion', 'tabs', 'carousel', 'timeline', 'stepCards', 'guidedSteps',
] as const;

export type AiBlockType = typeof AI_BLOCK_TYPES[number];

// Names the model reaches for that mean an existing type. Cheaper than losing the whole
// block to the `default` case when it writes "stepper" or "flashcards".
const TYPE_ALIASES: Record<string, AiBlockType> = {
  flashcards: 'flipCards',
  flipcards: 'flipCards',
  flipCardDeck: 'flipCards',
  stepper: 'guidedSteps',
  steps: 'guidedSteps',
  guidedsteps: 'guidedSteps',
  stepcards: 'stepCards',
  quiz: 'knowledgeCheck',
  knowledgecheck: 'knowledgeCheck',
  prompt: 'promptBlock',
  promptblock: 'promptBlock',
  code: 'runnableCode',
  runnablecode: 'runnableCode',
  sql: 'runnableCode',
  python: 'runnableCode',
  bulletlist: 'bulletList',
  orderedlist: 'orderedList',
  numberedList: 'orderedList',
  quote: 'blockquote',
};

const CALLOUT_VARIANTS = new Set(['note', 'tip', 'warning', 'info', 'success']);
const CHECK_FORMATS = new Set(['choice', 'fill', 'written']);
const CODE_LANGUAGES = new Set(['sql', 'python', 'javascript']);

// Depth guard for the recursive walk. The prompt asks for at most two levels of nesting;
// this only stops a malformed or adversarial response from recursing without end.
const MAX_DEPTH = 4;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const partArray = (v: unknown): AiBlockPart[] =>
  (Array.isArray(v) ? v.filter((p): p is AiBlockPart => !!p && typeof p === 'object') : []);

const textNode = (t: string): LessonDoc => ({ type: 'text', text: t });
const paragraph = (t: string): LessonDoc => (t ? { type: 'paragraph', content: [textNode(t)] } : { type: 'paragraph' });
const listItems = (items: string[]): LessonDoc[] =>
  items.map((item) => ({ type: 'listItem', content: [paragraph(item)] }));

/**
 * The block content of one container section. Every container child in the lesson schema is
 * `block+`, so this never returns an empty array -- an empty section would make TipTap drop
 * the whole container.
 */
function sectionContent(part: AiBlockPart, depth: number): LessonDoc[] {
  const nested = buildLessonNodes(part.children, depth + 1);
  if (nested.length) return nested;
  return [paragraph(str(part.body))];
}

/** A container node built from `parts`, or null when the model sent no usable sections. */
function container(
  type: string,
  childType: string,
  parts: AiBlockPart[],
  attrsFor: (part: AiBlockPart, index: number) => Record<string, unknown>,
  depth: number,
): LessonDoc | null {
  if (!parts.length) return null;
  return {
    type,
    content: parts.map((part, i) => ({
      type: childType,
      attrs: attrsFor(part, i),
      content: sectionContent(part, depth),
    })),
  };
}

/** A table node: the first row becomes the header row. */
function tableNode(rows: { cells?: string[] }[]): LessonDoc | null {
  const grid = rows
    .map((row) => (Array.isArray(row?.cells) ? row.cells.map((c) => str(c)) : []))
    .filter((cells) => cells.length);
  if (!grid.length) return null;
  const width = Math.max(...grid.map((cells) => cells.length));
  return {
    type: 'table',
    content: grid.map((cells, rowIndex) => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, col) => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [paragraph(cells[col] ?? '')],
      })),
    })),
  };
}

/**
 * Turn an AI block list into lesson (ProseMirror) nodes. Unknown types and blocks with
 * nothing usable in them are dropped rather than emitted empty, so a partial response
 * still produces a valid document.
 */
export function buildLessonNodes(blocks: unknown, depth = 0): LessonDoc[] {
  if (!Array.isArray(blocks) || depth > MAX_DEPTH) return [];

  const nodes: LessonDoc[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as AiBlock;
    const rawType = str(b.type);
    const type = (AI_BLOCK_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : TYPE_ALIASES[rawType] ?? TYPE_ALIASES[rawType.toLowerCase()] ?? '';
    const parts = partArray(b.parts);
    const text = str(b.text);
    const title = str(b.title);

    switch (type) {
      case 'paragraph': {
        if (text) nodes.push(paragraph(text));
        break;
      }
      case 'heading': {
        if (!text) break;
        const level = Math.min(4, Math.max(2, Number(b.level) || 4));
        nodes.push({ type: 'heading', attrs: { level }, content: [textNode(text)] });
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = strArray(b.items);
        if (items.length) nodes.push({ type, content: listItems(items) });
        break;
      }
      case 'blockquote': {
        if (text) nodes.push({ type: 'blockquote', content: [paragraph(text)] });
        break;
      }
      case 'table': {
        const table = tableNode(Array.isArray(b.rows) ? b.rows : []);
        if (table) nodes.push(table);
        break;
      }
      case 'callout': {
        const variant = CALLOUT_VARIANTS.has(str(b.variant)) ? str(b.variant) : 'note';
        const body = buildLessonNodes(b.children, depth + 1);
        if (!title && !text && !body.length) break;
        nodes.push({
          type: 'callout',
          attrs: { variant, title },
          content: body.length ? body : [paragraph(text)],
        });
        break;
      }
      case 'knowledgeCheck': {
        const question = str(b.question);
        if (!question) break;
        const format = CHECK_FORMATS.has(str(b.format)) ? str(b.format) : 'choice';
        const options = strArray(b.options);
        const accepted = strArray(b.acceptedAnswers);
        if (format === 'choice' && options.length < 2) break;
        const correctIndex = Number(b.correctIndex ?? 0);
        nodes.push({
          type: 'knowledgeCheck',
          attrs: {
            question,
            format,
            options: format === 'choice' ? options : [],
            correctIndex: correctIndex >= 0 && correctIndex < options.length ? correctIndex : 0,
            acceptedAnswers: format === 'fill' ? accepted : [],
            expectedAnswer: format === 'written' ? str(b.expectedAnswer) : '',
            explanation: str(b.explanation),
          },
        });
        break;
      }
      case 'runnableCode': {
        const language = CODE_LANGUAGES.has(str(b.language)) ? str(b.language) : 'sql';
        const code = str(b.code);
        if (!code) break;
        nodes.push({
          type: 'runnableCode',
          attrs: { language, code, setupSql: str(b.setupSql), setupPython: str(b.setupPython) },
        });
        break;
      }
      case 'promptBlock': {
        const prompt = str(b.prompt) || text;
        if (!prompt) break;
        nodes.push({
          type: 'promptBlock',
          attrs: { title: title || 'Try this prompt', prompt, showChatGpt: true, showClaude: true },
        });
        break;
      }
      case 'flipCards': {
        const cards = parts
          .map((p) => ({ front: str(p.front) || str(p.title), back: str(p.back) || str(p.body) }))
          .filter((c) => c.front && c.back);
        if (cards.length) {
          nodes.push({
            type: 'flipCardDeck',
            content: cards.map((c) => ({ type: 'flipCard', attrs: { front: c.front, back: c.back } })),
          });
        }
        break;
      }
      case 'accordion': {
        const node = container('accordion', 'accordionItem', parts,
          (p) => ({ title: str(p.title) || str(p.label), open: false }), depth);
        if (node) nodes.push(node);
        break;
      }
      case 'tabs': {
        const node = container('tabs', 'tabPanel', parts,
          (p, i) => ({ label: str(p.label) || str(p.title) || `Tab ${i + 1}` }), depth);
        if (node) nodes.push(node);
        break;
      }
      case 'carousel': {
        const node = container('carousel', 'carouselSlide', parts,
          (p) => ({ title: str(p.title) || str(p.label) }), depth);
        if (node) nodes.push(node);
        break;
      }
      case 'timeline': {
        const node = container('timeline', 'timelineEntry', parts,
          (p) => ({ date: str(p.date), title: str(p.title) || str(p.label) }), depth);
        if (node) nodes.push(node);
        break;
      }
      case 'stepCards': {
        const node = container('stepCards', 'stepCard', parts,
          (p) => ({ title: str(p.title) || str(p.label), highlightTitle: '', highlightBody: '' }), depth);
        if (node) nodes.push(node);
        break;
      }
      case 'guidedSteps': {
        const node = container('stepper', 'step', parts,
          (p) => ({ title: str(p.title) || str(p.label) }), depth);
        if (node) nodes.push(node);
        break;
      }
      default:
        break;
    }
  }
  return nodes;
}

/** Wrap AI blocks as a whole lesson document, for the course/document generators. */
export function buildLessonDoc(blocks: unknown): LessonDoc {
  const content = buildLessonNodes(blocks);
  return { type: 'doc', content: content.length ? content : [paragraph('')] };
}

/** Short human label for a block, used by the assistant preview. */
export function blockLabel(type: string | undefined): string {
  switch (str(type)) {
    case 'callout': return 'Callout';
    case 'knowledgeCheck': case 'quiz': return 'Knowledge check';
    case 'runnableCode': case 'code': case 'sql': case 'python': return 'Code playground';
    case 'promptBlock': case 'prompt': return 'AI prompt';
    case 'flipCards': case 'flashcards': return 'Flip cards';
    case 'accordion': return 'Collapsible sections';
    case 'tabs': return 'Tabs';
    case 'carousel': return 'Carousel';
    case 'timeline': return 'Timeline';
    case 'stepCards': return 'Step cards';
    case 'guidedSteps': case 'stepper': case 'steps': return 'Guided steps';
    case 'table': return 'Table';
    case 'heading': return 'Heading';
    case 'bulletList': case 'orderedList': return 'List';
    case 'blockquote': return 'Quote';
    default: return 'Text';
  }
}
