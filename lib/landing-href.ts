/**
 * Where a card on the landing page leads.
 *
 * The page has several card layouts -- a wide slider, a mobile scroller, a hover popup -- and
 * they were disagreeing about this, so it lives in one place and they all read it.
 *
 * Courses, guided projects and learning paths have public pages that show a signed-out visitor the
 * cover, blurb, outline/contents and price without exposing the private lesson material.
 *
 * The type always travels with the link. Slugs are unique within a table, not across them, and
 * the detail page tries tables in order -- so a course and an experience sharing a slug would
 * otherwise resolve to whichever happened to be looked up first, and the visitor would land on
 * the wrong content.
 */

export interface LandingLinkItem {
  id?: string | null;
  type?: string;
  slug?: string | null;
}

/** The value app/[id] expects in its catalogueType parameter, per landing item type. */
const CATALOGUE_TYPE: Record<string, string> = {
  course: 'course',
  ve: 'virtual_experience',
  path: 'learning_path',
};

export function landingHref(item: LandingLinkItem, user: unknown): string {
  const catalogueType = item.type ? CATALOGUE_TYPE[item.type] : undefined;
  if (catalogueType && item.slug) {
    return `/${item.slug}?catalogueType=${catalogueType}`;
  }
  if (item.type === 'path' && item.id) {
    return `/${item.id}?catalogueType=learning_path`;
  }
  return user ? '/student' : '/auth';
}
