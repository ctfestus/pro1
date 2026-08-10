'use client';

/**
 * Saving a student's own LinkedIn profile URL, and the student-facing copy for share claim outcomes.
 *
 * Both live here because the course player and BOTH virtual-experience players need them, and copy
 * that drifts between the three surfaces is how students end up with different advice for the same
 * error.
 */

import { supabase } from '@/lib/supabase';
import { parseLinkedInProfileVanity } from '@/lib/linkedin-post-url';

/**
 * Merge a LinkedIn profile URL into the signed-in student's `social_links`.
 *
 * This student-owned client-side write relies on the students own-update RLS policy. Existing social
 * links are read and merged rather than replaced -- a blind update here would wipe a student's
 * other socials.
 */
export async function saveMyLinkedInProfileUrl(
  url: string,
): Promise<{ ok: true; vanity: string } | { ok: false; error: string }> {
  const vanity = parseLinkedInProfileVanity(url);
  if (!vanity) {
    return { ok: false, error: 'That does not look like a LinkedIn profile link. It should look like linkedin.com/in/your-name.' };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Your session expired. Please refresh and try again.' };

  const { data: row, error: readError } = await supabase
    .from('students').select('social_links').eq('id', userId).maybeSingle();
  if (readError) return { ok: false, error: 'Could not save your profile. Please try again.' };

  const existing = (row as any)?.social_links;
  const socialLinks = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};

  const { error } = await supabase
    .from('students')
    .update({ social_links: { ...socialLinks, linkedin: `https://www.linkedin.com/in/${vanity}` } })
    .eq('id', userId);
  if (error) return { ok: false, error: 'Could not save your profile. Please try again.' };

  return { ok: true, vanity };
}

/**
 * Student-facing message for a failed share claim. `no_profile` is handled by a prompt, not copy.
 *
 * Deliberately never names the other profile on a mismatch: the author of a post a student pasted is
 * a third party, and echoing their handle back would leak it to someone who may just have grabbed a
 * random link. Saying which profile it was adds nothing the student can act on either.
 */
export function shareClaimErrorMessage(code: unknown): string {
  switch (code) {
    case 'author_mismatch':
      return 'That post was shared from a different LinkedIn profile, not the one saved on your account. Paste a link to your own post.';
    case 'already_claimed':
      return 'That post has already been submitted. Share your own post and paste its link.';
    // A real post URL that does not name its author, so it cannot be confirmed as theirs. Point them
    // at the Share button, which produces the linkedin.com/in/<you>_... form that does.
    case 'no_author_in_url':
      return 'That link does not show who wrote the post. Open your post on LinkedIn, use its Share button to copy the link, and paste that.';
    case 'invalid_url':
      return 'That does not look like a LinkedIn post URL. Paste the full link to your post.';
    default:
      return 'Could not save your link. Please try again.';
  }
}
