// Every call-to-action button on the landing templates ends in an arrow icon that carries no
// accessible name. So the text beside it is the link's only label, and resolveConfig spreads the
// saved config OVER the template defaults -- meaning a tenant who clears the field in Site
// Settings gets '' rather than the default, and the link becomes an unlabelled arrow.
//
// Hiding a section is what its Show toggle is for. Clearing the label must not be a way to ship a
// button that a screen reader announces as nothing.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'components/LandingPageClient.tsx'), 'utf8');

describe('landing CTA button labels', () => {
  it('never renders a config button label without a fallback', () => {
    // The bare form is the bug: `: ctaButton}` puts an empty string next to the arrow.
    for (const field of ['ctaButton', 'newsletterButton', 'stickyCtaButton']) {
      expect(page).toContain(`(${field} || '`);
      expect(page).not.toContain(`: ${field}}`);
    }
  });

  it('skips the CTA subtext and accent line instead of rendering empty blocks', () => {
    // These are prose, not controls, so a cleared field should collapse rather than leave a gap
    // or a stray line break in the heading.
    expect(page).toContain('{ctaSubtext && (');
    expect(page).toContain('{ctaHeadingAccent && <><br />');
  });
});
