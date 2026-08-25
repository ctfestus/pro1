import { describe, it, expect } from 'vitest';
import {
  toUserFacingError,
  NETWORK_ERROR_MESSAGE,
  GENERIC_ERROR_MESSAGE,
} from '@/lib/user-facing-error';

// A learner on festman.app was shown "Failed to fetch (<project>.supabase.co)" on the sign-in
// screen, because the auth page printed err.message straight into the UI. These pin what a
// person is allowed to read: never a host, never a JS error name, but never a translation of a
// message that was already written for them either.
describe('toUserFacingError', () => {
  it('replaces the reported failure and keeps the project host off the screen', () => {
    const reported = 'Failed to fetch (wbbcxctblfoyoboskazr.supabase.co)';
    expect(toUserFacingError(new TypeError(reported))).toBe(NETWORK_ERROR_MESSAGE);
    expect(toUserFacingError(new TypeError(reported))).not.toContain('supabase');
  });

  it('recognises every engine wording for a request that never arrived', () => {
    const wordings = [
      'Failed to fetch',                                   // Chromium
      'Load failed',                                       // WebKit
      'NetworkError when attempting to fetch resource.',   // Firefox
      'TypeError: fetch failed',                           // undici
      'Network request failed',
      'net::ERR_INTERNET_DISCONNECTED',
    ];
    for (const wording of wordings) {
      expect(toUserFacingError(new Error(wording))).toBe(NETWORK_ERROR_MESSAGE);
    }
  });

  it('passes through messages that were written for a person', () => {
    // Supabase's own auth strings are the reason pass-through is the default.
    expect(toUserFacingError(new Error('Invalid login credentials'))).toBe('Invalid login credentials');
    expect(toUserFacingError(new Error('Email not confirmed'))).toBe('Email not confirmed');
    // And the ones this codebase throws deliberately.
    const ours = 'This email is not eligible for a new signup. If you already have an account, please use the sign in option below.';
    expect(toUserFacingError(new Error(ours))).toBe(ours);
  });

  it('falls back to the generic line for machine text it has no phrase for', () => {
    // The backstop that matters: an unrecognised wording must still not leak infrastructure.
    expect(toUserFacingError(new Error('request to https://x.supabase.co/rest/v1/students failed')))
      .toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserFacingError(new Error('AbortError: signal is aborted without reason')))
      .toBe(GENERIC_ERROR_MESSAGE);
  });

  it('handles a thrown value that carries no usable message', () => {
    expect(toUserFacingError(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserFacingError(null)).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserFacingError({})).toBe(GENERIC_ERROR_MESSAGE);
    expect(toUserFacingError(new Error('   '))).toBe(GENERIC_ERROR_MESSAGE);
    // A bare string is thrown often enough to be worth accepting.
    expect(toUserFacingError('Cohort is full')).toBe('Cohort is full');
  });
});
