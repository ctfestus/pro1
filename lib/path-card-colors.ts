/**
 * The colours an instructor can give a learning path's card on the landing page.
 *
 * Each colour is a pair: a pale tint for the card body and a deep shade for its button, so the
 * dark text and the white button label stay readable whichever one is picked. A fixed set rather
 * than a free colour picker, so every card looks like it belongs on the same page.
 */

export const PATH_CARD_COLORS = {
  green:  { label: 'Green',  tint: '#D4E8D7', deep: '#2E7D32' },
  yellow: { label: 'Yellow', tint: '#FBEFC6', deep: '#7A4A12' },
  red:    { label: 'Red',    tint: '#F5D4D3', deep: '#C5372C' },
  blue:   { label: 'Blue',   tint: '#D6E2FB', deep: '#2F6FE0' },
  teal:   { label: 'Teal',   tint: '#CDEBEA', deep: '#00695C' },
  orange: { label: 'Orange', tint: '#FCE0C8', deep: '#B4520F' },
} as const;

export type PathCardColor = keyof typeof PATH_CARD_COLORS;

/** The order paths without a chosen colour take, so a row of them still varies. */
const AUTO_ORDER: PathCardColor[] = ['green', 'yellow', 'red', 'blue'];

export function isPathCardColor(value: unknown): value is PathCardColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PATH_CARD_COLORS, value);
}

/** The chosen colour, or the next one in AUTO_ORDER for a card at this position. */
export function pathCardColor(value: unknown, index: number) {
  return PATH_CARD_COLORS[isPathCardColor(value) ? value : AUTO_ORDER[index % AUTO_ORDER.length]];
}
