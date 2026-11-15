// The rules for judging a typed or chosen answer. Pure and free of server-only imports, so the
// course player (instant feedback) and lib/grade-question (the authoritative server grade) share
// one copy and can never disagree about what counts as correct.
//
// Code exercises (SQL/Python) are not here: they are judged by their stored pass flags and
// server-minted proofs, which only lib/grade-question can verify.

// AI-review question types: correct once the review player has stored the 'completed' sentinel.
export const REVIEW_TYPES = ['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'];

// Is `answer` (the stored string form) the right answer to question `q`?
export function isAnswerRight(q: any, answer: unknown): boolean {
  if (answer == null) return false;
  const ua = String(answer);
  const type = q?.type ?? 'multiple_choice';

  if (REVIEW_TYPES.includes(type)) return answer === 'completed';

  // Multiple-answer MCQ (multiple_choice / image_choice / code with multiSelect): correctAnswer and
  // the student answer are both '|||'-joined option text; grade is order-independent set equality.
  if (q?.multiSelect && (type === 'multiple_choice' || type === 'image_choice' || type === 'code')) {
    const norm = (s: string) => s.trim();
    const correct = new Set(String(q.correctAnswer ?? '').split('|||').map(norm).filter(Boolean));
    const chosen = new Set(ua.split('|||').map(norm).filter(Boolean));
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
      return accepted.includes(norm(ua));
    }
    const studentBlanks = ua.split('|||');
    if (studentBlanks.length !== blanks.length) return false;
    return blanks.every((b, i) => b.split('|').map(norm).includes(norm(studentBlanks[i] ?? '')));
  }

  // arrange: the answer is the '|||'-joined order, compared exactly. Everything else: exact text.
  return answer === q?.correctAnswer;
}
