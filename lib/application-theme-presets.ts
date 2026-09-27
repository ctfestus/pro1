import type { ThemeColors } from '@/lib/theme';

// Kept so forms saved during the earlier preset experiment remain readable.
export const APPLICATION_THEME_IDS = ['platform', 'signal', 'tide', 'grove', 'ember', 'monochrome', 'custom'] as const;
export type ApplicationThemeId = typeof APPLICATION_THEME_IDS[number];

export interface ApplicationCustomTheme {
  background: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
}

const LEGACY_THEME_COLORS: Partial<Record<ApplicationThemeId, string>> = {
  signal: '#23E6C8',
  tide: '#0B6E75',
  grove: '#2F6B45',
  ember: '#D85C2F',
  monochrome: '#111111',
};

function readableTextColor(background: string): string {
  const channels = background.slice(1).match(/.{2}/g)?.map(channel => Number.parseInt(channel, 16)) ?? [0, 0, 0];
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 255000;
  return luminance > 0.62 ? '#111111' : '#FFFFFF';
}

function validColor(value?: string): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

export function applicationThemeColors(
  base: ThemeColors,
  themeColor?: string,
  legacyTheme: ApplicationThemeId = 'platform',
  legacyCustom?: ApplicationCustomTheme,
): ThemeColors {
  const legacyColor = legacyTheme === 'custom' ? legacyCustom?.primary : LEGACY_THEME_COLORS[legacyTheme];
  const color = validColor(themeColor) ? themeColor : validColor(legacyColor) ? legacyColor : base.cta;
  return {
    ...base,
    page: `color-mix(in srgb, ${color} 6%, #ffffff)`,
    nav: '#FFFFFF',
    navBorder: `color-mix(in srgb, ${color} 16%, transparent)`,
    card: '#FFFFFF',
    cardBorder: 'transparent',
    input: `color-mix(in srgb, ${color} 11%, #ffffff)`,
    inputBorder: `color-mix(in srgb, ${color} 26%, #ffffff)`,
    pill: `color-mix(in srgb, ${color} 14%, #ffffff)`,
    skeleton: `color-mix(in srgb, ${color} 9%, #ffffff)`,
    divider: `color-mix(in srgb, ${color} 18%, transparent)`,
    text: '#151515',
    muted: '#505050',
    faint: '#7A7A7A',
    cta: color,
    ctaText: readableTextColor(color),
    accent: color,
    overlayBtn: '#FFFFFF',
    overlayText: '#151515',
    errorBg: '#FEF2F2',
    errorText: '#DC2626',
    errorBorder: '#FECACA',
    successBg: '#F0FDF4',
    successText: '#15803D',
    successBorder: '#BBF7D0',
  };
}
