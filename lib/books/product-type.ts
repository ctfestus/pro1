/**
 * What kind of digital product it is (migration 242). Client-safe.
 */
export const PRODUCT_TYPES = ['book', 'template', 'guide', 'prompt', 'skill', 'plugin', 'other'] as const;
export type ProductType = typeof PRODUCT_TYPES[number];

export const PRODUCT_TYPE_NAMES: Record<ProductType, string> = {
  book: 'Book', template: 'Template', guide: 'Guide', prompt: 'Prompt', skill: 'Skill', plugin: 'Plugin', other: 'Other',
};

export function isProductType(v: unknown): v is ProductType {
  return typeof v === 'string' && (PRODUCT_TYPES as readonly string[]).includes(v);
}

/** The custom name for "other": plain text, single spaces, 1 to 40 characters; null otherwise. */
export function cleanProductTypeLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= 40 ? t : null;
}

/** How the type reads on the page: "Template", or the author's own word for "other". */
export function productTypeLabel(type: unknown, custom?: string | null): string {
  if (type === 'other') return cleanProductTypeLabel(custom) ?? 'Digital product';
  return isProductType(type) ? PRODUCT_TYPE_NAMES[type] : 'Book';
}

/** Product web addresses (books.slug): lowercase letters, digits and hyphens, 2 to 120 characters. */
export const PRODUCT_ADDRESS = /^[a-z0-9][a-z0-9-]{1,119}$/;

/** Addresses that are pages of the store itself, so no product may take them. */
export const RESERVED_PRODUCT_ADDRESSES = new Set(['download', 'preview', 'new', 'edit', 'admin', 'api']);

/** A typed address made into a valid one: lowercase, spaces and underscores to hyphens, no doubles. */
export function normalizeProductAddress(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}
