/**
 * Tool/software logos shown beside a name: a course's category, a dashboard tool row, a
 * learner's skill, the assistant a lesson prompt targets.
 *
 * The set is data (table `tool_icons`, migration 185) layered over the built-in defaults below,
 * because instructors add tools this list could never anticipate -- before, a tool outside these
 * names rendered nothing, with nothing explaining why. Read the merged set through
 * `useToolIcons()` in lib/use-tool-icons.
 *
 * This module stays framework-free: the API route imports `normalizeToolName` from here, so
 * nothing in it may reach for React or the browser.
 */
import { resolveImageUrl, IMG_ICON } from '@/lib/cloudinary-url';

/**
 * The built-in thirteen names (twelve distinct logos -- azure is listed twice), kept as
 * defaults so the platform looks the same before anyone uploads anything. They are full
 * Storage URLs, which `resolveImageUrl` passes through untouched.
 *
 * ChatGPT and Claude in particular are structural rather than decorative -- lesson prompt blocks
 * use them to show which assistant a prompt is for -- so they must not depend on a tenant having
 * uploaded a logo.
 */
const BASE = 'https://wbbcxctblfoyoboskazr.supabase.co/storage/v1/object/public/Tools%20icons';

export const DEFAULT_TOOL_ICONS: Record<string, string> = {
  'chatgpt':        'https://jbdfdxqvdaztmlzaxxtk.supabase.co/storage/v1/object/public/Assets/openai-chatgpt-logo-icon-free-png.webp',
  'claude':         `${BASE}/Claude.png`,
  'excel':          `${BASE}/Excel.png`,
  'perplexity ai':  `${BASE}/Perplexity%20AI.png`,
  'power bi':       `${BASE}/Power%20BI.png`,
  'python':         `${BASE}/Python.png`,
  'sql':            `${BASE}/SQL.png`,
  'tableau':        `${BASE}/Tableau.png`,
  'zapier':         `${BASE}/Zapier.png`,
  'databricks':     `${BASE}/Databricks_Logo.png`,
  'aws':            `${BASE}/Amazon_Web_Services-Logo.wine.svg`,
  'azure':           `${BASE}/Microsoft_Azure.svg.png`,
  'microsoft azure': `${BASE}/Microsoft_Azure.svg.png`,
};

/** Retained for compatibility with existing imports of the old constant name. */
export const TOOL_ICONS = DEFAULT_TOOL_ICONS;

/**
 * The one place a tool name becomes a lookup key, shared by the writer and every reader so a
 * saved icon cannot fail to match the text it was saved for.
 *
 * Inner whitespace is collapsed as well as trimmed: "Power  BI" and "Power BI" are the same tool,
 * and a stray double space typed into a course category should not cost the logo. Case and edge
 * whitespace never distinguished two tools either.
 */
export function normalizeToolName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Look a name up in an already-merged map. Returns a deliverable URL, width-capped and
 * format-negotiated for an icon, or undefined when the tool has no logo.
 */
export function resolveToolIcon(icons: Record<string, string>, name: string): string | undefined {
  const key = normalizeToolName(name);
  if (!key) return undefined;
  const ref = icons[key];
  return ref ? resolveImageUrl(ref, IMG_ICON) : undefined;
}

/**
 * Defaults-only lookup, for callers with no access to the uploaded set -- module scope, or a
 * server render. Prefer `useToolIcons()` anywhere a component can use it, so an instructor's
 * uploads are honoured.
 */
export function getToolIcon(name: string): string | undefined {
  return resolveToolIcon(DEFAULT_TOOL_ICONS, name);
}
