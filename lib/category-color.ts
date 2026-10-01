/**
 * The pill colour for a content category, shared so a category reads as the same colour on
 * Explore and on the content's own overview page. Picked by a hash of the name, so it is stable
 * without anyone assigning colours. Every colour is light enough to carry dark text (#101828).
 */
const CATEGORY_COLORS = [
  '#bfdbfe',
  '#bbf7d0',
  '#fed7aa',
  '#bae6fd',
  '#fde68a',
  '#fbcfe8',
  '#99f6e4',
  '#cbd5e1',
];

export const CATEGORY_TEXT = '#101828';

export function categoryColor(category: string): string {
  const key = category.toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}
