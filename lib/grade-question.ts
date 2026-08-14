// Single source of truth for server-side question grading.
//
// Both the course attempt route (app/api/course/route.ts) and the certification attempt
// route (app/api/certification-attempt/route.ts) score answers through `gradeQuestion`,
// so an answer is judged identically regardless of which content type it belongs to.
//
// Client-supplied scores are never trusted -- the runtime players send raw answers and the
// server re-grades here. Code-exercise results (SQL/Python) are checked through their
// stored pass/skipped/solutionViewed flags; Python and SQL can additionally require a valid
// HMAC proof that the match was confirmed server-side (see signProof/verifyProof).

import { createHmac, timingSafeEqual } from 'crypto';

// AI-review question types: graded by the 'completed' sentinel the review players store.
export const REVIEW_TYPES = ['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'];

// Strip answer keys before sending exam questions to a student (the inverse of grading). The exam is
// scored server-side, so the taker never needs correctAnswer / solutions / expected results. Kept:
// options, optionImages, codeSnippet, and a pythonHasExpectedOutput flag. sqlExpectedResult is also
// stripped (a client-side SQL checker could self-grade against it).
export function sanitizeExamQuestions(questions: any): any[] {
  return (Array.isArray(questions) ? questions : []).map((q: any) => {
    if (!q || typeof q !== 'object') return q;
    const { correctAnswer, sqlSolution, pythonSolution, pythonExpectedOutput, sqlExpectedResult, rubric, expectedAnswer, explanation, ...safe } = q;
    return { ...safe, pythonHasExpectedOutput: !!String(pythonExpectedOutput ?? '').trim() };
  });
}

export function normalizePythonOutput(value: unknown): string {
  return String(value ?? '').trim();
}

// --- Exam-form assembly (integrity: randomize order, shuffle options, question pooling) ---

// Fisher-Yates shuffle using a supplied [0,1) rng, returning a new array (input untouched).
export function shuffleWith<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic PRNG from a string seed (xfnv1a hash -> mulberry32). Same seed -> same sequence, so
// option order stays stable across resume/refresh without persisting it (seed = attemptId:questionId).
export function seededRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Only real, scorable questions (exclude section headers / lesson-only / downloads pseudo-entries).
function isScorable(q: any): boolean {
  return !!q && !q.lessonOnly && !q.isSection && !q.isDownloads;
}

// Select and order the scorable questions delivered for one attempt.
// - poolSize > 0 and < total: draw that many at random (a fresh subset per attempt);
// - randomize: shuffle the delivered order, else keep the authored order.
// Returns the ordered list of question ids to persist on the attempt (empty when neither feature is on).
export function assembleExamFormIds(
  questions: any[],
  opts: { randomize?: boolean; poolSize?: number },
  rng: () => number,
): string[] {
  const randomize = opts.randomize === true;
  const poolSize = Number(opts.poolSize) || 0;
  if (!randomize && poolSize <= 0) return [];
  const indexed = (Array.isArray(questions) ? questions : []).filter(isScorable).map((q, i) => ({ id: q.id, i }));
  const pooling = poolSize > 0 && poolSize < indexed.length;
  let chosen = pooling ? shuffleWith(indexed, rng).slice(0, poolSize) : indexed.slice();
  if (randomize) chosen = shuffleWith(chosen, rng);
  else chosen.sort((a, b) => a.i - b.i); // random subset, but presented in authored order
  return chosen.map(c => c.id);
}

// Shuffle the answer options of a text-option question (correctAnswer is compared by TEXT, so display
// order does not affect grading). Skips `image` (index-based) and `arrange` (order is the answer).
export function withShuffledOptions(q: any, rng: () => number): any {
  const shufflable = q?.type === 'multiple_choice' || q?.type === 'image_choice' || q?.type === 'code';
  if (shufflable && Array.isArray(q.options) && q.options.length > 1) {
    return { ...q, options: shuffleWith(q.options, rng) };
  }
  return q;
}

// Tolerant parse: exercise answers are stored as JSON strings, but may already be objects.
export function parseAnswer(value: unknown): any | null {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function proofSecret(): string {
  return process.env.COURSE_PYTHON_PROOF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

// HMAC proof that a Python exercise's output was confirmed server-side. `contentId` binds the proof
// to a specific course/certification so it cannot be replayed on another; `attemptId` binds it to a
// single attempt so it cannot be reused across retakes or minted outside the live attempt window.
export function signProof(contentId: string, questionId: string, output: string, attemptId = ''): string {
  const secret = proofSecret();
  if (!secret) throw new Error('Python proof secret not configured');
  const payload = JSON.stringify({ v: 1, contentId, attemptId, questionId, output: normalizePythonOutput(output) });
  return `v1:${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

export function verifyProof(contentId: string, questionId: string, output: string, proof: unknown, attemptId = ''): boolean {
  if (typeof proof !== 'string' || !proof.startsWith('v1:')) return false;
  try {
    const expected = signProof(contentId, questionId, output, attemptId);
    const a = Buffer.from(proof);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface GradeContext {
  // Final answers to grade against (client final_answers merged over the stored attempt answers).
  storedAnswers: Record<string, any>;
  // Server-persisted answers, used to keep Python skipped/solutionViewed penalties sticky.
  persistedAnswers?: Record<string, any>;
  // Verifies a Python proof for this content. Omit to accept the stored `passed` flag without proof
  // (used where proofs are not minted). When provided, a Python answer must carry a valid proof.
  verifyProof?: (questionId: string, output: string, proof: unknown) => boolean;
  // Course SQL answers are browser-executed to preserve WASM semantics, but final grading can
  // require a server-minted proof for the exact student/query pair.
  verifySqlProof?: (questionId: string, query: string, proof: unknown) => boolean;
}

// Re-grade one question from its stored answer. Pure: no DB, no side effects.
export function gradeQuestion(q: any, ctx: GradeContext): boolean {
  const ua = ctx.storedAnswers[q.id];
  if (ua == null) return false;
  const type = q.type ?? 'multiple_choice';

  if (REVIEW_TYPES.includes(type)) return ua === 'completed';

  if (type === 'sql_exercise') {
    // Trust the browser-stored result only when the course route has minted a proof. Re-running
    // WASM in Node can disagree, so the proof is issued after comparing the browser result
    // against the hidden expected result server-side.
    const parsed = parseAnswer(ua);
    if (!parsed || parsed.skipped || parsed.solutionViewed) return false;
    if (ctx.verifySqlProof) {
      return !!parsed.passed && ctx.verifySqlProof(q.id, String(parsed.query ?? ''), parsed.proof);
    }
    return !!parsed.passed;
  }

  if (type === 'python_exercise') {
    const persisted = parseAnswer((ctx.persistedAnswers ?? {})[q.id]);
    if (persisted?.skipped || persisted?.solutionViewed) return false;
    const parsed = parseAnswer(ua);
    if (!parsed || parsed.skipped || parsed.solutionViewed || !parsed.passed) return false;
    return ctx.verifyProof ? ctx.verifyProof(q.id, parsed.output, parsed.proof) : true;
  }

  // Multiple-answer MCQ (multiple_choice / image_choice / code with multiSelect): correctAnswer and
  // the student answer are both '|||'-joined option text; grade is order-independent set equality.
  if (q.multiSelect && (type === 'multiple_choice' || type === 'image_choice' || type === 'code')) {
    const norm = (s: string) => s.trim();
    const correct = new Set(String(q.correctAnswer ?? '').split('|||').map(norm).filter(Boolean));
    const chosen = new Set(String(ua).split('|||').map(norm).filter(Boolean));
    return correct.size > 0 && correct.size === chosen.size && [...correct].every(c => chosen.has(c));
  }

  if (type === 'fill_blank') {
    const norm = (s: string) => s.trim().toLowerCase();
    // Multiple inline blanks are joined by '|||' (in both correctAnswer and the student answer);
    // within a blank, '|' separates accepted alternatives. A correctAnswer with no '|||' is a single
    // blank (the original behavior), so this stays backward compatible.
    const blanks = String(q.correctAnswer ?? '').split('|||');
    if (blanks.length <= 1) {
      const accepted = String(q.correctAnswer ?? '').split('|').map(norm);
      return accepted.includes(norm(String(ua)));
    }
    const studentBlanks = String(ua).split('|||');
    if (studentBlanks.length !== blanks.length) return false;
    return blanks.every((b, i) => b.split('|').map(norm).includes(norm(studentBlanks[i] ?? '')));
  }

  if (type === 'arrange') return ua === q.correctAnswer;

  return ua === q.correctAnswer;
}
