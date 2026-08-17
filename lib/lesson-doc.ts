// Lesson document contract: the canonical interactive-lesson format.
//
// Interactive lessons are authored and stored as ProseMirror / TipTap JSON in
// `lesson.doc`. A sanitized HTML `lesson.body` is always written alongside as a
// lossy-but-readable fallback for legacy renderers and exports. `doc` is canonical.
//
// This module is intentionally DEPENDENCY-FREE (no TipTap, no React) so it can be
// imported by server routes (e.g. the delete-cleanup path in app/api/forms/route.ts)
// without pulling the editor bundle into a server context. TipTap-dependent helpers
// (e.g. `lessonHtmlToDoc`) live in components/lesson/extensions.ts instead.

/**
 * Structural shape of a ProseMirror document node. This is intentionally a
 * minimal structural type rather than a re-export of TipTap's `JSONContent`,
 * so the content contract is not coupled to the editor library. It is
 * structurally compatible with `JSONContent` for passing into TipTap helpers.
 */
export interface LessonDoc {
  type?: string;
  content?: LessonDoc[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** True for a non-null object value. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether two lesson contents (a `doc` object or an HTML string) are the same content.
 *
 * Used by the editor/renderer to skip a `setContent` when a re-render hands them a NEW doc object
 * holding the SAME document -- the common case, since parent state updates rebuild the objects
 * around it. Reloading needlessly resets the caret and re-renders every node view. ProseMirror JSON
 * is plain data, so stringify is a fair structural comparison and far cheaper than the reload it
 * avoids. Key order is stable here because both sides come from the same producer.
 */
export function sameContent(
  a: LessonDoc | Record<string, unknown> | string | null | undefined,
  b: LessonDoc | Record<string, unknown> | string | null | undefined,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * Walk a lesson doc and collect every uploaded image URL referenced by an
 * `image` node (attrs.src). Used by the asset-cleanup path so inline images
 * stored inside `lesson.doc` are deleted from Cloudinary along with the
 * content, instead of orphaning. Pure JSON traversal -- safe on the server.
 */
export function extractDocImageUrls(doc: LessonDoc | null | undefined): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) urls.push(v); };
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isObject(node)) return;
    if (isObject(node.attrs)) {
      // inline images (attrs.src), carousel slide covers (attrs.cover), and the optional
      // logo on a collapsible section header (attrs.logoUrl)
      if (node.type === 'image') push(node.attrs.src);
      if (node.type === 'carouselSlide') push(node.attrs.cover);
      if (node.type === 'accordionItem') push(node.attrs.logoUrl);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(doc as unknown);
  return [...new Set(urls)];
}

/**
 * Return the doc with every glossary-term definition inlined into its text as
 * "term (definition)" and the `glossaryTerm` mark removed. The HTML body fallback is
 * run through a sanitizer that strips data-* attributes -- where the definition lives
 * (data-definition) -- so without this the body / export / legacy path would lose the
 * definition entirely (the canonical `doc` keeps it either way). Pure JSON traversal
 * (no TipTap, no DOM); returns the SAME reference when there is nothing to inline, so
 * callers can cheaply skip regenerating HTML.
 */
export function inlineGlossaryDefinitions<T extends LessonDoc | null | undefined>(doc: T): T {
  if (!isObject(doc as unknown)) return doc;
  const visit = (node: LessonDoc): LessonDoc => {
    let next = node;
    if (typeof node.text === 'string' && Array.isArray(node.marks)) {
      const term = node.marks.find((m) => m && m.type === 'glossaryTerm');
      const def = term?.attrs?.definition;
      if (term && typeof def === 'string' && def.trim()) {
        next = {
          ...node,
          text: `${node.text} (${def.trim()})`,
          marks: node.marks.filter((m) => m.type !== 'glossaryTerm'),
        };
      }
    }
    if (Array.isArray(next.content)) {
      const mapped = next.content.map(visit);
      if (mapped.some((child, i) => child !== next.content![i])) {
        next = { ...next, content: mapped };
      }
    }
    return next;
  };
  return visit(doc as LessonDoc) as T;
}

// Node attrs that carry author-written prose. Most block bodies live in child `content`
// (those nodes are `block+`), so the text walk already picks those up -- this list is for
// text a node keeps on itself: a callout's title, and the two faces of a flip card, which
// is an atom node with no child content at all.
const TEXT_ATTRS = new Set([
  'title', 'label', 'prompt', 'question', 'date', 'alt', 'caption', 'name', 'summary',
  'front', 'back',
]);

// knowledgeCheck attrs the tutor must never see. A lesson knowledge check is formative,
// but a tutor that can read the marked answer would simply hand it over when asked.
// `question` is allowed through so the tutor can still discuss what the check is testing.
const ANSWER_ATTRS = new Set(['correctIndex', 'acceptedAnswers', 'expectedAnswer', 'rubric', 'explanation', 'options']);

// Total budget for runnable-code content across the WHOLE lesson, and only when the learner
// actually asked about code. A per-block cap is not enough: a lesson with eight exercises would
// multiply it and swamp the prose.
const MAX_CODE_TOTAL_CHARS = 900;

/**
 * Table shapes without the rows. Seed scripts are mostly INSERT statements -- thousands of
 * characters of literal data that tell the tutor nothing it needs, so those statements are
 * dropped and only the DDL survives.
 */
function sqlSchemaOnly(sql: string): string {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !/^insert\b/i.test(s))
    .map((s) => `${s};`)
    .join('\n');
}

/** Just the imports, so the tutor knows which library the exercise is built on. */
function pythonImportsOnly(py: string): string {
  return py
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(import|from)\s/.test(l))
    .join('\n');
}

/**
 * Flatten a lesson doc to plain text for grounding an AI call (the lesson tutor).
 *
 * Walks the ProseMirror JSON collecting text nodes and the prose attrs listed above, one line
 * per block, and drops the answer-bearing attrs of a knowledge check so the extracted text can
 * be put in a prompt without leaking marked answers. Pure JSON traversal -- DOM-free /
 * server-safe, like the rest of this module.
 *
 * `includeCode` opts in the runnable-code content, and is meant to be set ONLY when the
 * learner's question is actually about code. It is off by default because that content is
 * bulky and is resent on every question: including it unconditionally is what makes a tutor
 * expensive. Even when on, it admits only the learner-visible `code`, the schema shape of a
 * SQL seed script, and the import lines of a Python one -- never the seed rows -- and the whole
 * lot shares one character budget.
 */
export function lessonPlainText(
  doc: LessonDoc | null | undefined,
  maxChars = 12000,
  { includeCode = false }: { includeCode?: boolean } = {},
): string {
  // Tracked as prose-or-code rather than one flat list, so the final trim can protect the code
  // the learner actually asked about. See the assembly at the end.
  const parts: { text: string; isCode: boolean }[] = [];
  const push = (v: unknown) => {
    if (typeof v !== 'string') return;
    const t = v.replace(/\s+/g, ' ').trim();
    if (t) parts.push({ text: t, isCode: false });
  };

  // Code keeps its line breaks: flattening a script to one line makes it much harder to
  // explain, and "walk me through this query" is the whole reason it is here.
  let codeLeft = includeCode ? MAX_CODE_TOTAL_CHARS : 0;
  const pushCode = (v: unknown, transform?: (s: string) => string) => {
    if (codeLeft <= 0 || typeof v !== 'string') return;
    let t = v.trim();
    if (transform) t = transform(t).trim();
    if (!t) return;
    if (t.length > codeLeft) t = `${t.slice(0, codeLeft)}\n(code truncated)`;
    codeLeft -= t.length;
    parts.push({ text: t, isCode: true });
  };

  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isObject(node)) return;

    const isCheck = node.type === 'knowledgeCheck';
    if (isObject(node.attrs)) {
      for (const [key, value] of Object.entries(node.attrs)) {
        if (isCheck && ANSWER_ATTRS.has(key)) continue;
        if (TEXT_ATTRS.has(key)) push(value);
      }
      if (includeCode && node.type === 'runnableCode') {
        pushCode(node.attrs.code);
        pushCode(node.attrs.setupSql, sqlSchemaOnly);
        pushCode(node.attrs.setupPython, pythonImportsOnly);
      }
    }
    push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };

  visit(doc as unknown);

  // Code gets its space reserved out of the budget BEFORE prose is measured against it.
  // Trimming the joined text from the end instead would cut whichever content came last, and a
  // runnable block sitting near the end of a long lesson is precisely the case where the
  // learner asked about the code and it is the code that would be dropped. Prose is still
  // trimmed in document order; code is always emitted whole, in place. Its own
  // MAX_CODE_TOTAL_CHARS cap keeps this reservation small enough that prose is never starved.
  const codeChars = parts.reduce((n, p) => (p.isCode ? n + p.text.length + 1 : n), 0);
  let proseLeft = Math.max(0, maxChars - codeChars);
  let truncated = false;
  const out: string[] = [];

  for (const part of parts) {
    if (part.isCode) { out.push(part.text); continue; }
    if (proseLeft <= 0) { truncated = true; continue; }
    if (part.text.length > proseLeft) {
      out.push(part.text.slice(0, proseLeft));
      proseLeft = 0;
      truncated = true;
      continue;
    }
    out.push(part.text);
    proseLeft -= part.text.length + 1;
  }

  const text = out.join('\n');
  return truncated ? `${text}\n(lesson truncated)` : text;
}

/**
 * Collect the SQL and Python setup scripts from every SHARED runnable-code block in a
 * lesson, so all shared blocks can run against one combined per-lesson runtime (define a
 * dataset once -> every shared block can query it, notebook-style). Blocks marked
 * `dataScope: 'own'` are excluded -- they keep their own isolated setup. Identical
 * scripts are de-duplicated (lessons often repeat the same CREATE TABLE in each block)
 * and joined in document order. Pure JSON traversal -- DOM-free / server-safe.
 */
export function collectRunnableSetup(doc: LessonDoc | null | undefined): { setupSql: string; setupPython: string } {
  const sql: string[] = [];
  const py: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isObject(node)) return;
    if (node.type === 'runnableCode' && isObject(node.attrs) && node.attrs.dataScope !== 'own') {
      const s = node.attrs.setupSql;
      const p = node.attrs.setupPython;
      if (typeof s === 'string' && s.trim() && !sql.includes(s)) sql.push(s);
      if (typeof p === 'string' && p.trim() && !py.includes(p)) py.push(p);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(doc as unknown);
  return { setupSql: sql.join('\n\n'), setupPython: py.join('\n\n') };
}
