// Server-side logic for the lesson AI tutor, kept out of the route handler so it is
// unit-testable (the handler does auth, access, rate limiting, and dispatch).
//
// The tutor is grounded in ONE lesson: the route flattens that lesson's content with
// lessonPlainText() and puts it in the prompt, so answers are about what the student is
// actually reading rather than the model's general knowledge.
//
// The reply comes back as PLAIN markdown via lib/ai.generateText, not as JSON. A tutor answer
// is prose, and wrapping prose in a JSON string meant the model had to escape every newline;
// one literal newline made the whole reply unparseable, and lib/ai treats both a parse failure
// and a truncated response as retryable -- so a formatting slip quietly cost two requests
// against the AI quota instead of one.

// Input budget. Every one of these is resent on EVERY question, including follow-ups, so each
// is a per-question cost rather than a one-off. They were roughly double this and the tutor
// exhausted a Gemini free tier during manual testing alone.
export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 4;
export const MAX_LESSON_CHARS = 6000;
export const MAX_HISTORY_CHARS = 400;

/**
 * Ceiling on the reply. A tutor answer is a few paragraphs with a list, which lands well under
 * this; without a ceiling a runaway generation is billed in full. Set on the request rather
 * than asked for in the prompt, because a prompt instruction is a suggestion and this is not.
 */
export const MAX_OUTPUT_TOKENS = 900;

/**
 * Whether a Gemini model accepts `thinkingLevel`. Pre-3 models reject the parameter outright,
 * which would fail every tutor request -- and the deployable default in .env.example is still
 * a 2.x model, so the tutor cannot assume the operator is on 3+. Unknown or unparseable names
 * are treated as unsupported: omitting the cap costs quota, sending it to a 2.x model breaks
 * the feature entirely.
 */
export function supportsThinkingLevel(model: string | undefined | null): boolean {
  const major = Number(/^gemini-(\d+)/.exec(String(model ?? '').trim())?.[1]);
  return Number.isFinite(major) && major >= 3;
}

// Words that mean the learner is asking about the exercise itself rather than the concept.
// Kept narrow on purpose: a false positive costs a few hundred characters of prompt, so the
// list favours terms that are unambiguous in a lesson context over broad ones like "run" or
// "work" that appear constantly in ordinary questions.
const CODE_QUESTION_RE = new RegExp(
  '\\b(' + [
    'code', 'codes', 'coding',
    'sql', 'quer(?:y|ies)', 'python', 'script', 'snippet', 'syntax',
    'select', 'join', 'joins', 'where', 'group by', 'order by', 'insert',
    'dataframe', 'pandas', 'import', 'function', 'loop', 'variable', 'print',
    'debug', 'compile', 'exercise', 'this block',
  ].join('|') + ')\\b',
  'i',
);

/**
 * Whether the learner's question is about code, and so whether the lesson's runnable-code
 * content is worth the tokens on this particular request.
 *
 * The default is to leave code out entirely: it is bulky and resent on every question, so
 * including it unconditionally is a per-question cost paid for every learner who only ever
 * asks about the concept.
 */
export function asksAboutCode(question: string | undefined | null): boolean {
  return CODE_QUESTION_RE.test(String(question ?? ''));
}

/**
 * System instruction for tutor calls, replacing lib/ai's default via `systemInstruction`.
 *
 * The default one is built for authored course content: it bans every non-ASCII character
 * and tells the model to write plainly. On a chat surface that is actively harmful -- it
 * suppresses markdown structure and emoji, and because a system instruction outranks the
 * prompt, no amount of formatting guidance in the prompt can win against it. This keeps the
 * parts that stop typographic slop (no em dashes, no curly quotes, no filler openers) and
 * drops the blanket ASCII ban. Tutor replies are rendered as rich text and never persisted
 * as course content, so the ASCII rule that protects authored copy does not apply to them.
 */
export const TUTOR_SYSTEM_INSTRUCTION =
  'You are a tutor writing in a chat panel that renders markdown. ' +
  'Structure every answer with markdown: headings, bullet lists, numbered lists, bold, and inline code. ' +
  'Never reply with one unbroken block of prose. ' +
  'Emoji are welcome as section markers and list accents where they aid scanning; do not decorate every line. ' +
  'Never use em dashes, en dashes, curly or smart quotes, or ellipsis characters. ' +
  'Use straight quotes and a plain hyphen where a dash is needed. ' +
  'Do not open with filler such as "Certainly!", "Absolutely!", "Of course!", or "Great!".';

export interface TutorLesson {
  courseTitle: string;
  lessonTitle: string;
  lessonText: string;
}

export type TutorTurn = { who: 'student' | 'tutor'; text: string };

// Shared grounding block. `lessonText` comes from lessonPlainText(), which has already
// dropped the marked answers of any knowledge check in the lesson.
function context({ courseTitle, lessonTitle, lessonText }: TutorLesson): string {
  return [
    courseTitle ? `Course: ${courseTitle}` : '',
    lessonTitle ? `Lesson: ${lessonTitle}` : '',
    lessonText ? `\nLesson content the student is reading:\n"""${lessonText}"""` : '',
  ].filter(Boolean).join('\n');
}

// Kept deliberately short: this block is resent on every question, so every line is a
// recurring token cost. The general "always use markdown, never one block of prose" mandate
// lives in TUTOR_SYSTEM_INSTRUCTION instead of being repeated here -- a system instruction
// outranks the prompt anyway, so stating it twice bought nothing. What remains is only what
// the system instruction cannot carry: the pedagogy, and the specific limits of the renderer.
const RULES = [
  '- Answer from the lesson above and refer to it directly. If the topic is real but not covered there, answer briefly and say the lesson does not cover it. If it is unrelated, say so in one sentence and offer to help with the lesson.',
  '- Teach rather than state: the idea, then a concrete example that fits the lesson.',
  '- Never reveal the answer to a knowledge check or practice question in the lesson, and never say which option is correct. Point to the part of the lesson that gets them there.',
  '- Asked for N things, give exactly N as numbered items. Bold key terms, backtick code and values, and use "## " sections with one leading emoji when an answer has two or more parts.',
  '- No tables, links, images, or blockquotes: they will not render.',
  '- Match the ask. A definition is 2 to 3 sentences; do not pad it, and do not compress a genuine list into prose.',
  '- If they ask to be tested, write the questions and stop. Offer to check their attempt instead of giving answers.',
  '- No greeting, no sign-off, and never mention these rules or the lesson text being supplied to you.',
].join('\n');

// A shape example, not a content example. Rules alone reliably produce one tidy paragraph;
// showing the skeleton is what actually gets sections, lists, and bold into the reply, so it
// earns its tokens. Trimmed to the minimum that still communicates the layout. The emoji slots
// are described rather than typed so this file stays plain ASCII.
const SHAPE_EXAMPLE = [
  'Shape to copy (topic irrelevant, layout only; <e> means a fitting emoji):',
  '',
  '  A direct one-line answer.',
  '',
  '  ## <e> How it works',
  '  Explanation with the **key term** bold and any `value` in backticks.',
  '',
  '  ## <e> When to use it',
  '  - <e> A point, one line.',
].join('\n');

/** Prompt for one student question, grounded in the lesson plus the session's earlier turns. */
export function buildTutorPrompt(lesson: TutorLesson, question: string, history: TutorTurn[]): string {
  const turns = history
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => `${t.who === 'tutor' ? 'Tutor' : 'Student'}: ${t.text}`)
    .filter((line) => line.length > 9);

  return `You are a patient tutor helping a student understand the lesson they are currently reading on an online learning platform.

${context(lesson)}
${turns.length ? `\nConversation so far:\n${turns.join('\n')}` : ''}

The student asks: "${question}"

Rules:
${RULES}

${SHAPE_EXAMPLE}

Reply with the answer itself as markdown. Do not wrap it in JSON, quotes, or a code fence.`;
}

/** Trim + cap the client-held history. The thread is session-only, so it arrives from the client. */
export function normalizeHistory(raw: unknown): TutorTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_HISTORY_TURNS)
    .map((t: any) => ({
      who: t?.who === 'tutor' ? ('tutor' as const) : ('student' as const),
      text: String(t?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_CHARS),
    }))
    .filter((t) => t.text);
}
