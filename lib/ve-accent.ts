// A deliverable can carry its own color (requirement.accentColor); unset, it uses the player's
// fixed accent. The card builds tints by appending alpha digits (`${accent}18`), so only a
// six-digit hex is accepted -- anything else from imports or AI edits falls back.
export const DELIVERABLE_ACCENT_PRESETS = ['#00b95c', '#0d9488', '#3E93FF', '#d97706', '#ea580c', '#f43f5e'];

// Matches the fixed accent both VE players use.
export const DEFAULT_VE_ACCENT = '#00b95c';

// Surfaces the deliverable card sits on. Both players use white in light mode; in dark mode the
// assignment player (#1E1F26) is lighter than the standalone one (#1a1a1a), so checking against
// it covers both.
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1E1F26';

// WCAG 2.x minimum for UI components and large text. The accent colors the checkbox, top bar,
// resource links and status line, so a custom pick below this is nudged until it reads.
const MIN_CONTRAST = 3;

export function isVeAccent(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Mixes the color toward black (light theme) or white (dark theme) in small steps until it
// clears MIN_CONTRAST against the card surface, keeping as much of the chosen hue as possible.
export function readableAccent(hex: string, isDark: boolean): string {
  const surface = isDark ? DARK_SURFACE : LIGHT_SURFACE;
  const target: [number, number, number] = isDark ? [255, 255, 255] : [0, 0, 0];
  const base = toRgb(hex);
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(base.map((v, i) => v + (target[i] - v) * t) as [number, number, number]);
    if (contrastRatio(mixed, surface) >= MIN_CONTRAST) return mixed === toHex(base) ? hex : mixed;
  }
  return toHex(target);
}

// Color for a mark drawn on top of the accent (the checkbox tick). White stays white on the
// default green (2.6:1); only a pale accent, where white would vanish, switches to near-black.
export function onAccent(hex: string): string {
  return contrastRatio('#ffffff', hex) >= 2.5 ? '#ffffff' : '#111111';
}

// The default keeps its existing look; only an author's own pick is made readable.
export function resolveDeliverableAccent(ownAccent: unknown, fallback: string, isDark: boolean): string {
  return isVeAccent(ownAccent) ? readableAccent(ownAccent, isDark) : fallback;
}

// Only deliverables carry their own color; switching a requirement to another type drops it.
export function deliverableAccentForType(accentColor: string | undefined, type: string): string | undefined {
  return type === 'task' || type === 'deliverable' ? accentColor : undefined;
}
