/**
 * Display fields for a LOCKED virtual experience.
 *
 * A virtual experience used to have two overview pages: the real one, and a separate simpler page
 * shown to anyone who could not open it -- so the same VE had two identities depending on who was
 * looking. There is now one overview, and this is what fills it in for a visitor who has not
 * bought yet: who the work is for, what tools it uses, who guides it, and the titles of the
 * modules and missions.
 *
 * What stays on the server is the work itself: the manager's brief, lesson bodies, requirements
 * and the dataset. Widening this to include any of those would turn a sales page into a way of
 * reading the experience for free.
 *
 * Shared by both catalogue routes so the signed-out and signed-in-without-access previews cannot
 * drift apart.
 */

export interface VePreviewOutlineLesson {
  id: string;
  title: string;
}

export interface VePreviewOutlineModule {
  id: string;
  title: string;
  lessons: VePreviewOutlineLesson[];
}

export interface VePreviewFields {
  industry: string | null;
  role: string | null;
  company: string | null;
  tagline: string | null;
  difficulty: string | null;
  duration: string | null;
  tools: string[];
  toolLogos: Record<string, string>;
  learnOutcomes: string[];
  managerName: string | null;
  managerTitle: string | null;
  guideId: string | null;
  guideSnapshot: unknown;
  mode: string | null;
  theme: string | null;
  font: string | null;
  customAccent: string | null;
  outline: VePreviewOutlineModule[];
}

/** The columns a preview needs. Pinned here so both routes select exactly the same set. */
export const VE_PREVIEW_COLUMNS =
  'modules, industry, role, company, tagline, difficulty, duration, tools, tool_logos, '
  + 'learn_outcomes, manager_name, manager_title, guide_id, guide_snapshot, '
  + 'mode, theme, font, custom_accent';

export function vePreviewFields(row: any): VePreviewFields {
  const modules = Array.isArray(row?.modules) ? row.modules : [];
  return {
    industry:      row?.industry      ?? null,
    role:          row?.role          ?? null,
    company:       row?.company       ?? null,
    tagline:       row?.tagline       ?? null,
    difficulty:    row?.difficulty    ?? null,
    duration:      row?.duration      ?? null,
    tools:         Array.isArray(row?.tools) ? row.tools : [],
    toolLogos:     row?.tool_logos    ?? {},
    learnOutcomes: Array.isArray(row?.learn_outcomes) ? row.learn_outcomes : [],
    managerName:   row?.manager_name  ?? null,
    managerTitle:  row?.manager_title ?? null,
    guideId:       row?.guide_id      ?? null,
    guideSnapshot: row?.guide_snapshot ?? null,
    mode:          row?.mode          ?? null,
    theme:         row?.theme         ?? null,
    font:          row?.font          ?? null,
    customAccent:  row?.custom_accent ?? null,
    // Titles only, the same rule the locked course outline follows. Requirements are counted on
    // the overview, so they are deliberately absent rather than zeroed: no deliverable text and
    // no deliverable count leaves the server.
    outline: modules.map((mod: any) => ({
      id:    String(mod?.id ?? ''),
      title: String(mod?.title ?? ''),
      lessons: (Array.isArray(mod?.lessons) ? mod.lessons : []).map((lesson: any) => ({
        id:    String(lesson?.id ?? ''),
        title: String(lesson?.title ?? ''),
      })),
    })),
  };
}
