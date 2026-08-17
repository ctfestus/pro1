import { Type } from '@google/genai';

// Gemini response schema + prompt guide for the AI block contract in lib/lesson-blocks.
//
// Split from that module because this half imports @google/genai (server only) while the
// converter is imported by the client editor too. Both AI surfaces -- the course/document
// generators and the inline "Ask AI" assistant -- share the guide, so adding a lesson node
// to the library means editing ONE list here instead of hunting through prompt strings.
//
// The guide matters as much as the schema: lib/ai.generateJSON only passes the response
// schema to Gemini, so on the OpenAI fallback the prompt text is the only contract.

/**
 * Every interactive block the AI can author, with its exact JSON shape and when to use it.
 * Keep in step with AI_BLOCK_TYPES + buildLessonNodes in lib/lesson-blocks.
 */
export const LESSON_BLOCK_GUIDE = `BLOCK LIBRARY -- a lesson is an ordered array of these blocks.

Text and layout:
- paragraph: {"type":"paragraph","text":"..."}
- heading: {"type":"heading","level":4,"text":"Sub-section title"}
- bulletList: {"type":"bulletList","items":["point 1","point 2"]}
- orderedList: {"type":"orderedList","items":["first","second"]}
- blockquote: {"type":"blockquote","text":"A standout rule or tip"}
- table: {"type":"table","rows":[{"cells":["Column A","Column B"]},{"cells":["value","value"]}]} -- the first row is the header. Use for comparisons and reference grids.

Interactive blocks (this is what makes the lesson worth reading on screen):
- callout: {"type":"callout","variant":"note|tip|warning|info|success","title":"Short label","text":"..."} -- highlight a rule, a pitfall, or why this matters.
- flipCards: {"type":"flipCards","parts":[{"front":"Term or question","back":"Definition or answer"}]} -- tap to reveal, 3 to 6 cards. Best for terminology and recall.
- accordion: {"type":"accordion","parts":[{"title":"Section title","body":"..."}]} -- collapsible sections for detail the learner opens on demand (FAQ, edge cases).
- tabs: {"type":"tabs","parts":[{"label":"Tab label","body":"..."}]} -- parallel options, comparisons, or the same task in two tools.
- carousel: {"type":"carousel","parts":[{"title":"Slide title","body":"..."}]} -- step through one idea per slide.
- timeline: {"type":"timeline","parts":[{"date":"2019","title":"Milestone","body":"..."}]} -- chronological events or stages.
- stepCards: {"type":"stepCards","parts":[{"title":"Step title","body":"..."}]} -- scannable numbered instructions, all visible at once. Use for a procedure the learner follows while working.
- guidedSteps: {"type":"guidedSteps","parts":[{"title":"Step title","body":"..."}]} -- the same idea as stepCards but revealed one step at a time, so the learner focuses on the current step.
- promptBlock: {"type":"promptBlock","title":"Try this prompt","prompt":"..."} -- a ready-made AI prompt the learner can copy or open in ChatGPT or Claude. Use when the skill is applied by prompting an AI tool.
- runnableCode: {"type":"runnableCode","language":"sql|python|javascript","code":"...","setupSql":"...","setupPython":"..."} -- an editable snippet the learner runs inside the lesson. SQL: always include setupSql with CREATE TABLE plus INSERT (3-5 rows) so the query actually runs. Python: put imports in setupPython.
- knowledgeCheck: ungraded practice, one of three formats:
  - {"type":"knowledgeCheck","format":"choice","question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"one sentence on why"}
  - {"type":"knowledgeCheck","format":"fill","question":"A statement with ___ for the gap","acceptedAnswers":["answer","alternative"],"explanation":"..."}
  - {"type":"knowledgeCheck","format":"written","question":"An open question","expectedAnswer":"model answer","explanation":"..."}

NESTING -- put blocks inside blocks:
Every section in "parts" takes EITHER "body" (plain text) OR "children" (an array of blocks), and a callout takes "children" instead of "text". Use children whenever a section needs more than one paragraph or needs its own interactive block:
{"type":"tabs","parts":[
  {"label":"The rule","children":[{"type":"paragraph","text":"..."},{"type":"callout","variant":"warning","title":"Common mistake","text":"..."}]},
  {"label":"Practice","children":[{"type":"runnableCode","language":"sql","code":"SELECT ...","setupSql":"CREATE TABLE ..."},{"type":"knowledgeCheck","format":"choice","question":"...","options":["A","B"],"correctIndex":0,"explanation":"..."}]}
]}
Nest at most two levels deep, and never nest a block type inside itself.

Choosing well: pick the block that fits the content, not the flashiest one. Terminology becomes flipCards, a procedure becomes stepCards or guidedSteps, alternatives become tabs, chronology becomes timeline, optional detail becomes accordion, and anything the learner should try becomes runnableCode, promptBlock, or a knowledgeCheck. Plain paragraphs are still correct for explanation.`;

const STR = { type: Type.STRING };
const STR_ARRAY = { type: Type.ARRAY, items: STR };

/**
 * One branch of the block union: the literal `type` plus only the fields that type uses,
 * with the content-bearing ones required.
 *
 * The `required` list is the whole point. Described as one object with every field optional,
 * the model answers a request for an AI prompt with
 * {"type":"promptBlock","title":"Try this prompt","variant":"warning"} -- a plausible field
 * from a different block type, and no prompt text -- and a tabs block with labels but no
 * bodies. Making `prompt` and `body` required in their own branch is what stops that.
 */
const branch = (
  type: string,
  properties: Record<string, unknown>,
  required: string[],
) => ({
  type: Type.OBJECT,
  properties: { type: { type: Type.STRING, enum: [type], description: `always "${type}"` }, ...properties },
  required: ['type', ...required],
});

/** A container branch: `parts` carrying one section shape. */
const containerBranch = (
  type: string,
  partProperties: Record<string, unknown>,
  partRequired: string[],
  description: string,
) => branch(type, {
  parts: {
    type: Type.ARRAY,
    description,
    items: { type: Type.OBJECT, properties: partProperties, required: partRequired },
  },
}, ['parts']);

const BODY = { type: Type.STRING, description: 'the section body, one or two sentences of plain text' };

/**
 * Gemini response schema for one lesson block, as a discriminated union.
 *
 * Only for surfaces that cannot skip the schema -- the course/document generators, where
 * blocks are one field of a much larger response. A blocks-only call should pass no schema
 * at all and lean on LESSON_BLOCK_GUIDE, which lets the model nest blocks inside blocks;
 * this union is deliberately flat, since unrolling nesting through 17 branches would cost
 * more schema than the nesting is worth on a generated lesson.
 */
export function lessonBlockSchema(): Record<string, unknown> {
  return {
    anyOf: [
      branch('paragraph', { text: STR }, ['text']),
      branch('heading', { text: STR, level: { type: Type.NUMBER, description: 'always 4' } }, ['text']),
      branch('bulletList', { items: { ...STR_ARRAY, description: 'the list items as plain strings' } }, ['items']),
      branch('orderedList', { items: { ...STR_ARRAY, description: 'the ordered items as plain strings' } }, ['items']),
      branch('blockquote', { text: STR }, ['text']),
      branch('table', {
        rows: {
          type: Type.ARRAY,
          description: 'rows top to bottom, the first row is the header',
          items: { type: Type.OBJECT, properties: { cells: { ...STR_ARRAY, description: 'cells left to right' } }, required: ['cells'] },
        },
      }, ['rows']),
      branch('callout', {
        variant: { type: Type.STRING, enum: ['note', 'tip', 'warning', 'info', 'success'] },
        title: { type: Type.STRING, description: 'short header label, 3-5 words' },
        text: { type: Type.STRING, description: 'the callout body' },
      }, ['variant', 'title', 'text']),
      // options and correctIndex are required even though only format "choice" uses them:
      // left optional the model omits them on a choice question, and a choice question with
      // no options is dropped on the way in. The converter ignores them for the other formats,
      // where the guide says to send an empty array.
      branch('knowledgeCheck', {
        format: { type: Type.STRING, enum: ['choice', 'fill', 'written'] },
        question: STR,
        options: { ...STR_ARRAY, description: 'format choice: the answer options. Other formats: empty' },
        correctIndex: { type: Type.NUMBER, description: 'format choice: 0-based index of the correct option. Other formats: 0' },
        acceptedAnswers: { ...STR_ARRAY, description: 'format fill: accepted answers for the gap' },
        expectedAnswer: { type: Type.STRING, description: 'format written: model answer' },
        explanation: { type: Type.STRING, description: 'one sentence shown after answering' },
      }, ['format', 'question', 'options', 'correctIndex', 'explanation']),
      branch('runnableCode', {
        language: { type: Type.STRING, enum: ['sql', 'python', 'javascript'] },
        code: { type: Type.STRING, description: 'the snippet the learner edits and runs' },
        setupSql: { type: Type.STRING, description: 'sql only: CREATE TABLE + INSERT seeding 3-5 rows' },
        setupPython: { type: Type.STRING, description: 'python only: imports and helper setup, no output' },
      }, ['language', 'code']),
      branch('promptBlock', {
        title: { type: Type.STRING, description: 'the card title' },
        prompt: { type: Type.STRING, description: 'the full prompt text the learner copies' },
      }, ['title', 'prompt']),
      containerBranch('flipCards', {
        front: { type: Type.STRING, description: 'the term, question, or prompt' },
        back: { type: Type.STRING, description: 'the definition or answer' },
      }, ['front', 'back'], '3 to 6 cards'),
      containerBranch('accordion', { title: STR, body: BODY }, ['title', 'body'], '2 to 6 collapsible sections'),
      containerBranch('tabs', { label: { type: Type.STRING, description: 'the tab label' }, body: BODY }, ['label', 'body'], '2 to 5 tabs'),
      containerBranch('carousel', { title: STR, body: BODY }, ['title', 'body'], '3 to 6 slides'),
      containerBranch('timeline', { date: { type: Type.STRING, description: 'the date or period' }, title: STR, body: BODY }, ['date', 'title', 'body'], 'entries in chronological order'),
      containerBranch('stepCards', { title: STR, body: BODY }, ['title', 'body'], 'the steps in order'),
      containerBranch('guidedSteps', { title: STR, body: BODY }, ['title', 'body'], 'the steps in order'),
    ],
  };
}
