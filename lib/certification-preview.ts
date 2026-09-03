/**
 * Overview metadata for a certification, for a viewer who cannot sit it yet.
 *
 * A certification used to have two overview pages: its real one, and a separate simpler page for
 * anyone without access -- so the same certification looked like two different things depending on
 * who was looking. There is one overview now, and this fills it in for a visitor who has not
 * bought yet.
 *
 * This is the same shape get-exam already returns, and it is safe for the same reason: a
 * certification's questions are NEVER in its config. They are handed out by start-attempt when the
 * clock starts, so a candidate cannot read them beforehand -- the overview only ever knew how MANY
 * questions there are. Nothing here changes that. `questions` is read on the server to produce a
 * count and to list which sections exist; no question text, option or answer key leaves.
 */

/**
 * The columns a preview needs. Pinned here so both catalogue routes select the same set.
 *
 * Deliberately absent: study_guide_url, poster_url, practice_test_url, practice_questions,
 * prep_items and playground_data. Those are the preparation material a learner is paying for --
 * downloadable guides, a practice test, a practice run over a separate question bank. Shipping
 * them to a viewer who has not bought the certification hands over the paid half of it, which is
 * why they are not fetched here at all rather than merely hidden by the page.
 */
export const CERTIFICATION_PREVIEW_COLUMNS =
  'title, description, cert_type, passmark, time_limit, max_attempts, retake_cooldown_hours, '
  + 'exam_protection, cover_image, badge_image_url, theme, mode, font, custom_accent, '
  + 'skill_areas, question_pool_size, questions';

/** A slide that carries a gradeable answer, matching the exam route's own count. */
const scorable = (q: any) => !q?.lessonOnly && !q?.isSection && !q?.isDownloads;

export function certificationPreviewConfig(cert: any) {
  const questions = Array.isArray(cert?.questions) ? cert.questions : [];
  const scorableCount = questions.filter(scorable).length;
  // With pooling, each attempt draws a subset -- the overview shows the drawn count.
  const poolSize = Number(cert?.question_pool_size) || 0;
  const questionCount = poolSize > 0 ? Math.min(poolSize, scorableCount) : scorableCount;

  // What the exam IS, never what helps you pass it. `practiceCount` is absent on purpose too: it
  // is what makes the taker offer a Practice run, so leaving it out removes the button rather
  // than leaving a paid action one prop away from being clickable.
  return {
    title: cert?.title, description: cert?.description, certType: cert?.cert_type, isCertification: true,
    questionCount,
    passmark: cert?.passmark, timeLimit: cert?.time_limit,
    maxAttempts: cert?.max_attempts, retakeCooldownHours: cert?.retake_cooldown_hours ?? 24,
    // Conditions of sitting, not help with passing, so it belongs on a sales page. It must be
    // sent rather than left out: the taker reads a missing value as protected, so omitting it
    // made every locked certification warn about a protected exam, including ones configured
    // without protection.
    examProtection: cert?.exam_protection,
    coverImage: cert?.cover_image, badgeImageUrl: cert?.badge_image_url || null,
    theme: cert?.theme, mode: cert?.mode, font: cert?.font, customAccent: cert?.custom_accent,
    skillAreas: Array.isArray(cert?.skill_areas) ? cert.skill_areas : [],
    sections: ['technical', 'practical'].filter(s => questions.some((q: any) => q?.section === s)),
  };
}
