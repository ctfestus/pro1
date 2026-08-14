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
