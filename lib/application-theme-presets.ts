import type { ThemeColors } from '@/lib/theme';

export const APPLICATION_THEME_IDS = ['platform', 'signal', 'tide', 'grove', 'ember', 'monochrome', 'custom'] as const;
export type ApplicationThemeId = typeof APPLICATION_THEME_IDS[number];

export interface ApplicationCustomTheme {
  background: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
}

export const DEFAULT_APPLICATION_CUSTOM_THEME: ApplicationCustomTheme = {
  background: '#F2F5FA',
  surface: '#FFFFFF',
  primary: '#0056D2',
  accent: '#FF9933',
  text: '#111111',
};

export const APPLICATION_THEME_PRESETS: Array<{
  id: Exclude<ApplicationThemeId, 'custom'>;
  name: string;
  description: string;
  swatches: string[];
  colors?: Partial<ThemeColors>;
}> = [
  { id: 'platform', name: 'Platform', description: 'Uses your platform brand colors.', swatches: [] },
  {
    id: 'signal', name: 'Signal', description: 'Dark, digital, and high contrast.', swatches: ['#071316', '#23E6C8', '#FFB547'],
    colors: { page: '#071316', nav: '#0C2024', navBorder: '#16383E', card: '#0C2024', cardBorder: 'transparent', input: '#112C31', inputBorder: '#21464C', pill: '#15343A', skeleton: '#15343A', text: '#F2FFFD', muted: '#B4D3CE', faint: '#789D97', cta: '#23E6C8', ctaText: '#04110F', accent: '#FFB547', overlayBtn: '#F2FFFD', overlayText: '#071316' },
  },
  {
    id: 'tide', name: 'Tide', description: 'Calm teal with a warm highlight.', swatches: ['#EAF4F6', '#0B6E75', '#FF8A5B'],
    colors: { page: '#EAF4F6', nav: '#FFFFFF', navBorder: '#C8DEE2', card: '#FFFFFF', cardBorder: 'transparent', input: '#DCECEF', inputBorder: '#C1DADF', pill: '#DCECEF', skeleton: '#D2E5E8', text: '#102A2E', muted: '#3F6267', faint: '#718F94', cta: '#0B6E75', ctaText: '#FFFFFF', accent: '#FF8A5B' },
  },
  {
    id: 'grove', name: 'Grove', description: 'Natural greens with a grounded warmth.', swatches: ['#F2F4EA', '#2F6B45', '#D59B3D'],
    colors: { page: '#F2F4EA', nav: '#FFFFFF', navBorder: '#DCE2CF', card: '#FFFFFF', cardBorder: 'transparent', input: '#E7ECDE', inputBorder: '#D4DDC7', pill: '#E7ECDE', skeleton: '#DEE5D3', text: '#1D2B21', muted: '#526458', faint: '#7F8E83', cta: '#2F6B45', ctaText: '#FFFFFF', accent: '#D59B3D' },
  },
  {
    id: 'ember', name: 'Ember', description: 'Warm and energetic without feeling loud.', swatches: ['#FFF4EC', '#D85C2F', '#147D78'],
    colors: { page: '#FFF4EC', nav: '#FFFFFF', navBorder: '#F2D9C8', card: '#FFFFFF', cardBorder: 'transparent', input: '#FBE5D5', inputBorder: '#F0CFB8', pill: '#FBE5D5', skeleton: '#F5DCCB', text: '#331D15', muted: '#745548', faint: '#A17E6E', cta: '#D85C2F', ctaText: '#FFFFFF', accent: '#147D78' },
  },
  {
    id: 'monochrome', name: 'Monochrome', description: 'Minimal black, white, and a gold signal.', swatches: ['#F0F0ED', '#111111', '#D6A400'],
    colors: { page: '#F0F0ED', nav: '#FFFFFF', navBorder: '#D8D8D3', card: '#FFFFFF', cardBorder: 'transparent', input: '#E6E6E1', inputBorder: '#D0D0CA', pill: '#E6E6E1', skeleton: '#DDDDD7', text: '#111111', muted: '#4D4D49', faint: '#7B7B75', cta: '#111111', ctaText: '#FFFFFF', accent: '#D6A400' },
  },
];

function readableTextColor(background: string): string {
  const channels = background.slice(1).match(/.{2}/g)?.map(channel => Number.parseInt(channel, 16)) ?? [0, 0, 0];
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 255000;
  return luminance > 0.62 ? '#111111' : '#FFFFFF';
}

export function applicationThemeColors(base: ThemeColors, theme: ApplicationThemeId = 'platform', custom: ApplicationCustomTheme = DEFAULT_APPLICATION_CUSTOM_THEME): ThemeColors {
  if (theme === 'platform') return base;
  if (theme === 'custom') {
    return {
      ...base,
      page: custom.background,
      nav: custom.surface,
      card: custom.surface,
      cardBorder: 'transparent',
      input: `color-mix(in srgb, ${custom.surface} 72%, ${custom.background})`,
      inputBorder: `color-mix(in srgb, ${custom.text} 14%, transparent)`,
      pill: `color-mix(in srgb, ${custom.surface} 65%, ${custom.background})`,
      skeleton: `color-mix(in srgb, ${custom.surface} 55%, ${custom.background})`,
      text: custom.text,
      muted: `color-mix(in srgb, ${custom.text} 72%, transparent)`,
      faint: `color-mix(in srgb, ${custom.text} 52%, transparent)`,
      cta: custom.primary,
      ctaText: readableTextColor(custom.primary),
      accent: custom.accent,
    };
  }
  const preset = APPLICATION_THEME_PRESETS.find(item => item.id === theme);
  return { ...base, ...(preset?.colors ?? {}) };
}
