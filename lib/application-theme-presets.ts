import type { ThemeColors } from '@/lib/theme';

// Kept so forms saved during the earlier preset experiment remain readable.
export const APPLICATION_THEME_IDS = ['platform', 'signal', 'tide', 'grove', 'ember', 'monochrome', 'custom'] as const;
export type ApplicationThemeId = typeof APPLICATION_THEME_IDS[number];
export type ApplicationThemeMode = 'light' | 'dark';

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
  mode: ApplicationThemeMode = 'light',
): ThemeColors {
  const legacyColor = legacyTheme === 'custom' ? legacyCustom?.primary : LEGACY_THEME_COLORS[legacyTheme];
  const color = validColor(themeColor) ? themeColor : validColor(legacyColor) ? legacyColor : base.cta;
  if (mode === 'dark') {
    return {
      ...base,
      page: '#0B0D12',
      nav: '#11141B',
      navBorder: '#252B35',
      card: '#11141B',
      cardBorder: 'transparent',
      input: '#191D26',
      inputBorder: '#343B48',
      pill: '#1D222C',
      skeleton: '#202631',
      divider: '#2A303B',
      text: '#F6F7F9',
      muted: '#C5CAD2',
      faint: '#8F98A6',
      cta: color,
      ctaText: readableTextColor(color),
      accent: color,
      overlayBtn: '#F6F7F9',
      overlayText: '#11141B',
      errorBg: '#2B171B',
      errorText: '#FB7185',
      errorBorder: '#5F2530',
      successBg: '#10261C',
      successText: '#4ADE80',
      successBorder: '#1F5134',
    };
  }
  return {
    ...base,
    page: `color-mix(in srgb, ${color} 6%, #ffffff)`,
    nav: '#FFFFFF',
    navBorder: '#E1E4E9',
    card: '#FFFFFF',
    cardBorder: 'transparent',
    input: '#FFFFFF',
    inputBorder: '#DDE1E7',
    pill: `color-mix(in srgb, ${color} 14%, #ffffff)`,
    skeleton: '#F1F3F5',
    divider: '#E5E7EB',
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
