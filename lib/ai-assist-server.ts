import { Type } from '@google/genai';
import { LESSON_BLOCK_GUIDE } from '@/lib/lesson-blocks-ai';
import { buildLessonNodes, type AiBlock } from '@/lib/lesson-blocks';

// Server-side logic for the inline "Ask AI" route, kept out of the route handler so it is
// unit-testable (the handler just does auth, rate limiting, and dispatch).
//
// Interactive results are the shared AI block tree (lib/lesson-blocks), the same contract the
// course generators use, so the assistant can build every lesson node the editor supports and
// can nest one inside another (a callout inside a tab, a knowledge check inside a step). The
// old per-format payloads could only ever produce a flat block with paragraph bodies.
//
// Every prompt states its exact JSON shape. This matters because lib/ai.generateJSON only
// passes the response schema to Gemini -- the OpenAI fallback gets json_object mode with no
// schema, so the shape (and the literal word "JSON", which OpenAI's json mode requires) has
// to live in the prompt for the fallback to return the expected structure.

export const TEXT_ACTIONS = new Set([
  'improve', 'expand', 'summarize', 'shorten', 'grammar', 'simplify', 'formal', 'continue', 'custom',
]);

/**
 * Interactive block kinds the assistant offers. One entry per element in the editor's insert
 * menu that an AI can author (image, audio, and file attachment need a real file, so they are
 * out), plus "auto", which lets the model choose.
 */
export const BLOCK_KINDS = [
  'auto', 'callout', 'knowledgeCheck', 'flipCards', 'stepCards', 'guidedSteps',
  'accordion', 'tabs', 'carousel', 'timeline', 'table', 'promptBlock', 'sql', 'python',
] as const;
export type BlockKind = typeof BLOCK_KINDS[number];

export const BLOCK_KIND_SET = new Set<string>(BLOCK_KINDS);
export const INTERACTIVE_ACTIONS = new Set<string>(BLOCK_KINDS.map((k) => `make_${k}`));
export const ALLOWED_ACTIONS = new Set<string>([...TEXT_ACTIONS, ...INTERACTIVE_ACTIONS]);

export const MAX_TEXT = 6000;
export const MAX_INSTRUCTION = 500;
export const MAX_CONTEXT = 1500;

// ---- Gemini response schemas ---

export const TEXT_SCHEMA = {
  type: Type.OBJECT,
  properties: { result: { type: Type.STRING } },
  required: ['result'],
};

/**
 * Block responses deliberately run WITHOUT a response schema.
 *
 * A block is a union: a promptBlock needs `prompt`, a table needs `rows`, a tabs block needs
 * `parts`. A Gemini response schema can only describe that as one object with every field
 * optional, and the model then fills whichever fields look plausible -- asked for an AI
 * prompt it returned {"type":"promptBlock","title":"Try this prompt","variant":"info"} with
 * no prompt text at all, which converts to nothing and fails the request. The same prompt
 * with no schema returns the right block every time, because the guide shows one exact shape
 * per type. Nothing is lost by dropping it: the shape has to be in the prompt anyway for the
 * schema-less OpenAI fallback, and usableBlocks below rejects whatever does not convert.
 */
// Temperature is deliberately low: most block actions restructure the author's existing
// sentences, and a warmer setting rewrites them into the model's own voice.
export const BLOCK_CALL_OPTS = { temperature: 0.4, thinkingLevel: 'low' as const, geminiRetries: 2 };

// ---- Prompts ---

const TEXT_BASE =
  'You are editing one passage of an interactive lesson for an online learning platform. ' +
  'Preserve the meaning and the author\'s voice. Keep roughly the same paragraph structure ' +
  'unless the instruction says otherwise. Plain text only -- no markdown, no surrounding quotes.';

const TEXT_TASKS: Record<string, string> = {
  improve:   'Improve clarity, flow, and word choice without changing the meaning.',
  expand:    'Expand with one or two more sentences of useful detail or a brief example. Stay concise.',
  summarize: 'Summarize into a shorter version that keeps the key points.',
  shorten:   'Make it noticeably shorter and tighter while keeping the meaning.',
  grammar:   'Fix spelling and grammar only. Do not change the wording or style beyond what is needed for correctness.',
  simplify:  'Rewrite in simpler, plainer language for a beginner. Avoid jargon.',
  formal:    'Rewrite in a more formal, professional tone.',
  continue:  'Continue writing naturally from where this passage ends. The "result" must be ONLY the new continuation, not the original text.',
};

function selectionBlock(text: string, context: string, contextLabel: string): string {
  const ctx = context ? `\n\nSurrounding lesson context (${contextLabel}):\n"""${context}"""` : '';
  return `\n\nSelected lesson text:\n"""${text}"""${ctx}`;
}

export function buildTextPrompt(action: string, text: string, instruction: string, context: string): string {
  const selected = selectionBlock(text, context, 'for tone only -- do not rewrite or repeat it');
  const shape = '\n\nRespond as JSON: {"result": "<the rewritten passage>"}';
  const task = action === 'custom'
    ? `Apply this instruction to the selected text: "${instruction}".`
    : TEXT_TASKS[action] ?? '';
  return `${TEXT_BASE} ${task}${selected}${shape}`;
}

/**
 * Free-instruction prompt for a surface that can hold interactive blocks. The instruction
 * decides the answer: "make this friendlier" is still a rewrite, "turn this into tabs with a
 * quiz in the last one" is a block tree. Asking the model to label its own answer beats
 * guessing from the instruction wording.
 */
export function buildInstructionPrompt(text: string, instruction: string, context: string): string {
  return `You are editing an interactive lesson for an online learning platform. The author selected a passage and asked: "${instruction}".
${selectionBlock(text, context, 'for grounding only -- do not rewrite it')}

Decide what the instruction is asking for:
- A rewrite or new prose -> answer with mode "text".
- Any interactive element, layout, or structure (tabs, cards, steps, a quiz, a callout, a table, a code playground, a prompt, or several of them) -> answer with mode "blocks" and build it.
Follow the instruction exactly, including how many items it asks for and anything it says to nest inside something else.

${LESSON_BLOCK_GUIDE}

Rules for blocks:
- Build what was asked and nothing more. Do not append a knowledge check, a heading, or a summary that was not requested.
- ${REUSE_WORDING}
- The exception is a block the selection cannot supply -- a knowledge check, or a code sample where the selection has no code. Write those, grounded strictly in the selection.
- For a promptBlock, the selection is normally the prompt itself: copy it word for word into the "prompt" field and write only the title.
- If the instruction itself asks for different or expanded writing, follow the instruction; it outranks these rules.
- Plain text inside every field: no markdown, no HTML.

Respond as JSON, one of:
{"mode": "text", "result": "<the rewritten passage>"}
{"mode": "blocks", "blocks": [ <block>, ... ]}`;
}

/**
 * Most menu entries RESTRUCTURE the author's passage; they do not get to rewrite it.
 *
 * Without this the model treats the selection as a brief and returns a polished paraphrase,
 * so the author asks for tabs and gets their own paragraph reworded back at them. The source
 * text stays in the document (blocks are inserted after it), which makes a paraphrase read as
 * a near-duplicate of the paragraph above it.
 */
const REUSE_WORDING = [
  "Keep the author's wording. Move the sentences that are already in the selection into the block and keep the voice and the vocabulary.",
  'Change only what the structure forces: a short section label or title, a linking word, or splitting one sentence across two sections. Labels and titles may be written fresh because the selection has none.',
  'Do not paraphrase, polish, summarize, expand, or add anything the selection does not already say.',
  'Use fewer sections rather than inventing content to fill them. Every section must carry text that came from the selection.',
].join('\n- ');

// The blocks the selection usually cannot supply, because a passage of prose contains no
// question and no code. These write new content, grounded in the passage -- but if the
// selection IS the thing being asked for, it is kept as it stands.
const WRITE_FRESH = [
  'This block is something the selection does not already contain, so write it.',
  "Ground it strictly in the selection: reuse its wording and terminology wherever it fits, and introduce no facts, terms, or examples the selection does not support.",
].join('\n- ');

const FRESH_KINDS = new Set<BlockKind>(['knowledgeCheck', 'sql', 'python']);

/**
 * The AI prompt block is a wrapper, not a generator: it takes a prompt the author has
 * already written and gives the learner a copy button and a launch-in-ChatGPT/Claude link.
 * So the selection is the prompt, and the one thing that must not happen is the model
 * improving it -- an edited prompt is a different prompt, and the author cannot see the edit
 * without reading both side by side.
 */
const COPY_VERBATIM = [
  'The selection IS the prompt. Put it in the "prompt" field exactly as the author wrote it, word for word, keeping its line breaks and any placeholders in square brackets.',
  'Do not rewrite, reword, reformat, shorten, expand, or append instructions of your own. The only thing you write is the short title.',
  'Only if the selection is prose ABOUT a prompt rather than a prompt itself, compose the prompt it describes, in the selection\'s own wording, adding nothing it does not support.',
].join('\n- ');

// What each menu entry asks for. "auto" is the only one that leaves the choice to the model.
const KIND_DIRECTIVE: Record<BlockKind, string> = {
  auto:           'Choose the ONE block type that presents this content best and build it. Prefer an interactive block over plain paragraphs when the content supports it.',
  callout:        'Present the selection as ONE callout. Pick the variant that fits (note, tip, warning, info, or success) and give it a short title.',
  knowledgeCheck: 'Write ONE knowledge check testing the key idea. Use format "choice" with 3 or 4 options and exactly one correct answer unless the content clearly suits a fill-in-the-blank or a written response.',
  flipCards:      'Build ONE flipCards deck by splitting the selection into 3 to 6 cards. Each front is the term or question the selection already names; each back is the definition or answer as the selection states it.',
  stepCards:      'Build ONE stepCards block by splitting the selection into its ordered steps. Each step keeps the selection\'s sentence for that step as its body, under a short title.',
  guidedSteps:    'Build ONE guidedSteps block by splitting the selection into its ordered steps. Each step keeps the selection\'s sentence for that step as its body, under a short title.',
  accordion:      'Build ONE accordion by grouping the selection into 2 to 6 collapsible sections, each section holding the sentences it already contains under a short title.',
  tabs:           'Build ONE tabs block by dividing the selection into 2 to 5 tabs along the split the passage already makes (parallel topics, a comparison, alternative approaches). Each tab holds the selection\'s own sentences for that side.',
  carousel:       'Build ONE carousel by splitting the selection into 3 to 6 slides, one idea per slide, each slide holding the sentences that carry that idea.',
  timeline:       'Build ONE timeline from the events the selection describes, each entry with its date or period, a short title, and the selection\'s own description.',
  table:          'Build ONE table from the values the selection compares. The first row is the header. Cells hold the selection\'s own terms, shortened to a few words.',
  promptBlock:    'Put the selection into ONE promptBlock, so the learner can copy it or open it straight in ChatGPT or Claude. Add a short title naming what the prompt does.',
  sql:            'Build ONE runnableCode block with language "sql". Use the query the selection already contains if there is one, otherwise write a query that demonstrates the concept. Always include setupSql with CREATE TABLE plus INSERT seeding 3-5 realistic rows so it runs.',
  python:         'Build ONE runnableCode block with language "python". Use the script the selection already contains if there is one, otherwise write a short script that demonstrates the concept. Put any imports in setupPython.',
};

/** Prompt for one menu entry. Returns a block array so any entry can nest other blocks. */
export function buildBlockPrompt(kind: BlockKind, text: string, context: string): string {
  return `You are restructuring a passage of an interactive lesson into a lesson block for an online learning platform. The author wrote this passage and is keeping it -- your job is to lay it out as the block, not to rewrite it.

${KIND_DIRECTIVE[kind]}
${selectionBlock(text, context, 'for grounding only -- do not pull it into the block')}

${LESSON_BLOCK_GUIDE}

Rules:
- ${kind === 'promptBlock' ? COPY_VERBATIM : FRESH_KINDS.has(kind) ? WRITE_FRESH : REUSE_WORDING}
- Return the requested block only. The author's passage stays in the document above, so do not repeat it as a paragraph, and do not add a heading, an intro, or a summary around the block.
- Plain text inside every field: no markdown, no HTML.

Respond as JSON: {"blocks": [ <block>, ... ]}`;
}

// ---- Validation ---

/**
 * Keep the model's block array only if it converts to at least one real lesson node.
 * The client rebuilds the nodes from the same list with the same function, so a list that
 * survives here is a list the editor can insert.
 */
export function usableBlocks(raw: unknown): AiBlock[] | null {
  if (!Array.isArray(raw)) return null;
  const blocks = raw.filter((b): b is AiBlock => !!b && typeof b === 'object');
  return buildLessonNodes(blocks).length ? blocks : null;
}
