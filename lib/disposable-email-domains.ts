/**
 * A speed bump for throwaway addresses at public signup. Not a wall, and not pretending to be:
 * there are thousands of disposable-mail domains and new ones appear daily, so any list shipped
 * in a repo is out of date the week it lands. This one covers the handful of services that show
 * up in practice, at zero cost and with no third-party lookup.
 *
 * What actually carries the weight is email confirmation -- an address has to receive a link and
 * be clicked before the account becomes usable. This list only removes the laziest attempts, and
 * spares a support conversation later when a student cannot be reached at all.
 *
 * Kept as a suffix match so a subdomain (foo.mailinator.com) is caught too, since several of these
 * services hand out arbitrary subdomains.
 */
const DISPOSABLE_DOMAINS = [
  '10minutemail.com',
  'dispostable.com',
  'discard.email',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'harakirimail.com',
  'inboxkitten.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mytemp.email',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'tmpmail.net',
  'trashmail.com',
  'yopmail.com',
] as const;

/**
 * True when the address belongs to a known throwaway-mail service.
 *
 * A malformed address returns false rather than true: this function answers one narrow question,
 * and callers already validate the address separately. Returning true here for anything unparseable
 * would quietly turn a validation problem into a "your email provider is blocked" message, which is
 * the wrong thing to tell someone who simply mistyped.
 */
export function isDisposableEmailDomain(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
}
