/**
 * The "what is this path for" fields, shaped for the public overview page.
 *
 * A path could always say what it CONTAINED -- a list of courses -- but not what it was for, so a
 * visitor had to infer the skills, the audience and the tooling from course titles. These are the
 * fields that answer that, and they are display copy: nothing here is content a learner pays for.
 *
 * Shared by both catalogue routes for the same reason the path items are: the signed-in and
 * signed-out previews fill the same page, and two copies of this mapping is how they last drifted
 * apart.
 */

export interface PathOverviewFields {
  overview: string | null;
  skills: string[];
  whoShouldTake: string[];
  /** Tool NAMES. Icons resolve through the tool_icons registry at render time. */
  tools: string[];
}

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(v => String(v ?? '').trim()).filter(Boolean) : [];

export function pathOverviewFields(row: any): PathOverviewFields {
  return {
    overview: row?.overview ?? null,
    skills: list(row?.skills),
    whoShouldTake: list(row?.who_should_take),
    tools: list(row?.tools),
  };
}
