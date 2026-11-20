/**
 * What a catalogue preview says about an item beyond its description, and only what it has.
 *
 * Built in one place for the two surfaces that show the preview: /api/student/catalogue for
 * Explore and the landing page's data loader for visitors.
 */

export const cleanList = (list: string[] | null | undefined) =>
  (list ?? []).map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);

export type PreviewFactsRow = {
  learn_outcomes?: string[] | null;
  skills?: string[] | null;
  topics?: string[] | null;
  tools?: string[] | null;
  difficulty?: string | null;
  duration?: string | null;
  time_limit?: number | null;
  passmark?: number | null;
};

export type PreviewFacts = {
  outcomes?: string[];
  level?: string;
  duration?: string;
  tools?: string[];
  topics?: string[];
  examMinutes?: number;
  passmark?: number;
};

export function previewFacts(r: PreviewFactsRow): PreviewFacts {
  // A digital product's skills are what the buyer gets from it.
  const outcomes = cleanList(r.learn_outcomes ?? r.skills).slice(0, 3);
  const topics = cleanList(r.topics).slice(0, 4);
  const tools = cleanList(r.tools);
  return {
    ...(outcomes.length ? { outcomes } : {}),
    ...(r.difficulty ? { level: r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1) } : {}),
    ...(r.duration ? { duration: r.duration } : {}),
    ...(tools.length ? { tools } : {}),
    ...(topics.length ? { topics } : {}),
    ...(r.time_limit && r.time_limit > 0 ? { examMinutes: r.time_limit } : {}),
    ...(r.passmark ? { passmark: r.passmark } : {}),
  };
}
