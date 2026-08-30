// What the payments screen calls the thing a learner bought, and how it describes the end of it.
//
// These guard a decision rather than a calculation. The product is a fixed period of access that
// does not renew; calling it a subscription sets up an expectation the platform never meets, and
// the surprise then lands as "revoked" at exactly the wrong moment.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(
  join(process.cwd(), 'components/student/subscription-payments.tsx'),
  'utf8',
);

/** Every quoted string in the file, one per line. */
const quoted = (component.match(/'[^']{4,}'|`[^`]{4,}`/g) ?? []).join('\n');

/**
 * Prose a learner actually reads. A quoted run carrying JSX, braces or an arrow is code that
 * happens to mention the `subscription` variable, not something on the screen.
 */
const learnerProse = quoted
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => /[a-z] [a-z]/.test(line))
  // Comments are not copy. A quote elsewhere in the file can open a match that runs into
  // one, so they have to be dropped explicitly.
  .filter(line => !line.startsWith('//') && !line.startsWith('*'))
  .filter(line => !/[<>{}=]|className|\/api\/|@\/lib\//.test(line));

describe('how access is described to a learner', () => {
  it('never tells someone their access was revoked', () => {
    // Revoked is what you say to someone who broke a rule, not to someone who reached the end
    // of what they paid for.
    expect(quoted.toLowerCase()).not.toContain('revoked');
  });

  it('says plainly that access does not renew', () => {
    // The whole disclosure used to be one line of grey micro-copy, against a design that
    // implied something ongoing.
    expect(component).toContain('It does not renew automatically');
  });

  it('offers access rather than a subscription', () => {
    expect(component).not.toContain('Choose a subscription plan');
    expect(component).toContain("'Choose your access'");
  });

  it('offers renewal to anyone who has a plan, not only while it is still running', () => {
    // Gating the heading on active access meant a lapsed learner -- the one person most likely
    // to renew -- was told to "choose a subscription plan" as though they had never bought one.
    expect(component).toContain("if (status === 'active') return { heading: 'Extend your access', action: 'Add more time' }");
    expect(component).toContain("return { heading: 'Renew your plan', action: 'Renew plan' }");
  });

  it('names the end date instead of only a status word', () => {
    expect(component).toContain('Your access ended on ${fmtDate(subscription.current_period_end)}');
    expect(component).toContain('Your access runs until ${fmtDate(subscription.current_period_end)}');
  });

  it('points a lapsed learner at the way back', () => {
    expect(quoted).toContain('Renew below to continue');
    expect(component).toContain("heading: 'Renew your plan'");
  });

  it('keeps the word subscription out of what a learner reads', () => {
    // It stays in tables, routes and identifiers, which nobody reads. This checks the strings
    // that reach the screen.
    expect(learnerProse.filter(line => /subscription/i.test(line))).toEqual([]);
  });

  it('is reading real prose, not an empty list', () => {
    // The redesigned hero also carries unquoted JSX prose, so pin real learner-facing copy
    // directly rather than relying only on the quoted-string extraction above.
    expect(component).toContain('Starter plan');
    expect(component).toContain('Upgrade to Pro');
    expect(component).toContain('Choose duration');
  });
});
