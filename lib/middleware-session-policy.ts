// API routes where middleware deliberately skips its cookie-session lookup because the
// Route Handler owns authentication through requireUser/requireRole. Keep this list
// targeted: several APIs (including upload, assets, and assignment submit-confirm)
// authenticate from cookies and still depend on the middleware account-state gate.
// Never replace this allowlist with a blanket `/api` bypass.
export const SESSION_LOOKUP_FREE_API_PATHS = [
  '/api/account/complete-setup',
  '/api/activity/feed',
  '/api/platform-settings',
  '/api/promotions',
] as const;

export const SESSION_LOOKUP_FREE_API_PATH_SET = new Set<string>(
  SESSION_LOOKUP_FREE_API_PATHS,
);
