/**
 * Public path of a piece of content on the shared detail route, app/[id], for share menus,
 * copy-link buttons and social share URLs.
 *
 * The type travels with the link. Slugs are unique within a table, not across them, and the
 * detail page (and its link-preview metadata) tries tables in order, so an experience sharing a
 * slug with a course would otherwise open, and preview, as the course. Same rule as
 * lib/landing-href, keyed on the dashboard's content_type / config flags instead.
 *
 * Events never carry a type: app/[id] only resolves an event from an untyped link.
 */
export interface ContentLinkItem {
  id?: string | null;
  slug?: string | null;
  content_type?: string | null;
  config?: { isCourse?: boolean; isVirtualExperience?: boolean; isGuidedProject?: boolean } | null;
}

/** The catalogueType value app/[id] accepts for this item, or null when it takes none. */
export function contentCatalogueType(item: ContentLinkItem): string | null {
  const type = item.content_type;
  if (type === 'virtual_experience' || type === 'guided_project' || item.config?.isVirtualExperience || item.config?.isGuidedProject) {
    return 'virtual_experience';
  }
  if (type === 'certification' || type === 'learning_path') return type;
  if (type === 'course' || item.config?.isCourse) return 'course';
  return null;
}

export function contentPath(item: ContentLinkItem): string {
  const ref = item.slug || item.id || '';
  const catalogueType = contentCatalogueType(item);
  return catalogueType ? `/${ref}?catalogueType=${catalogueType}` : `/${ref}`;
}
