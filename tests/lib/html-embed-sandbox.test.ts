import { describe, expect, it } from 'vitest';
import { HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';

describe('HTML embed sandbox', () => {
  const flags = HTML_EMBED_SANDBOX.split(' ');

  it('lets links open new tabs as ordinary pages', () => {
    // Without the escape, a tab opened from the embed inherits the sandbox and any page that needs
    // storage (this app included) crashes in it.
    expect(flags).toEqual(expect.arrayContaining(['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox']));
  });

  it('never lets the embed reach the app', () => {
    for (const forbidden of ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-forms', 'allow-modals']) {
      expect(flags).not.toContain(forbidden);
    }
  });
});
