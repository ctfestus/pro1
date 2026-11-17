// A failure that waiting will not fix: every AI provider tried refused the site's own setup (a
// missing, invalid or unauthorised API key). Kept apart from a busy service so the screen does not
// say "try again in a moment" when trying again cannot help.
//
// Kept out of lib/ai so routes can still recognise it where tests replace lib/ai with a mock.

import { NextResponse } from 'next/server';

export class AiConfigurationError extends Error {
  constructor() {
    // Still says "unavailable": callers that match on that text (the lesson tutor) keep working.
    super('AI service unavailable: the AI provider is not configured correctly');
    this.name = 'AiConfigurationError';
  }
}

/** True when a provider error means the site's AI setup is wrong rather than the service busy. */
export function isMisconfiguredProviderError(err: unknown): boolean {
  const error = err as { status?: number; message?: string } | null;
  if (error?.status === 401 || error?.status === 403) return true;
  // Gemini reports these inside the message text rather than as a status code.
  return /credential is not configured|api key not valid|api_key_invalid|invalid api key|incorrect api key|invalid x-api-key|you didn't provide an api key|permission_denied|unauthenticated|"code":\s*40[13]\b/i
    .test(String(error?.message ?? ''));
}

/** What a route sends for that failure. */
export function aiConfigurationResponse(): NextResponse {
  return NextResponse.json(
    { error: 'There is a problem with the AI service. Please tell your administrator. Your work has not been lost.' },
    { status: 503 },
  );
}
