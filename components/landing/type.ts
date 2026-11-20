/**
 * Type and spacing for the public pages, from Material Design 3.
 *
 * Type roles are the M3 type scale: size, line height and tracking. Weights are not taken from M3;
 * each element keeps the page's own weight (black section headings, bold titles and buttons). The
 * font itself stays the tenant's heading and body font from Site settings.
 *
 * Spacing sits on the 8dp grid: window margins of 16 on a phone and 24 from 600px up, 48 / 64
 * between sections, 16 / 24 gutters between cards.
 */
import type { CSSProperties } from 'react';

export const M3 = {
  headlineMedium: { fontSize: 28, lineHeight: '36px', letterSpacing: 0 },
  headlineSmall:  { fontSize: 24, lineHeight: '32px', letterSpacing: 0 },
  titleLarge:     { fontSize: 22, lineHeight: '28px', letterSpacing: 0 },
  titleMedium:    { fontSize: 16, lineHeight: '24px', letterSpacing: '0.15px' },
  titleSmall:     { fontSize: 14, lineHeight: '20px', letterSpacing: '0.1px' },
  bodyLarge:      { fontSize: 16, lineHeight: '24px', letterSpacing: '0.5px' },
  bodyMedium:     { fontSize: 14, lineHeight: '20px', letterSpacing: '0.25px' },
  labelLarge:     { fontSize: 14, lineHeight: '20px', letterSpacing: '0.1px' },
  labelMedium:    { fontSize: 12, lineHeight: '16px', letterSpacing: '0.5px' },
} satisfies Record<string, CSSProperties>;

/** Display roles change size at the medium breakpoint, which inline styles cannot, so they are classes. */
export const DISPLAY_CLASS = 'text-[36px] leading-[44px] md:text-[45px] md:leading-[52px]';

/** Window margins: 16 on a phone, 24 from 600px. */
export const GUTTER = 'px-4 sm:px-6';
/** Space above and below a page section. */
export const SECTION_Y = 'py-12 md:py-16';
/** A Material button: 40 high with 24 either side, Label large. */
export const BUTTON_PAD = '10px 24px';
