/**
 * Where a card on the landing page leads.
 *
 * The page has several card layouts -- a wide slider, a mobile scroller, a hover popup -- and
 * they were disagreeing about this, so it lives in one place and they all read it.
 *
 * Courses and guided projects have a public page that shows a signed-out visitor the cover, the
 * blurb and the price. Learning paths have no page of their own yet: no slug, no route, so there
 * is nothing to link to and they still go to sign-in.
 *
 * The type always travels with the link. Slugs are unique within a table, not across them, and
 * the detail page tries tables in order -- so a course and an experience sharing a slug would
 * otherwise resolve to whichever happened to be looked up first, and the visitor would land on
 * the wrong content.
 */

export interface LandingLinkItem {
  type?: string;
  slug?: string | null;
}

/** The value app/[id] expects in its catalogueType parameter, per landing item type. */
const CATALOGUE_TYPE: Record<string, string> = {
  course: 'course',
  ve: 'virtual_experience',
};

export function landingHref(item: LandingLinkItem, user: unknown): string {
  const catalogueType = item.type ? CATALOGUE_TYPE[item.type] : undefined;
  if (catalogueType && item.slug) {
    return `/${item.slug}?catalogueType=${catalogueType}`;
  }
  return user ? '/student' : '/auth';
}
