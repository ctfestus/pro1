// Where a learner goes to lift an AI review limit.
//
// Shared by the server gate, the entitlement route, the client hook and every player fallback.
// It was written out five times before this; the copies are the kind that stay identical right
// up until the pricing page moves.
//
// Deliberately dependency-free so client components can import it.
export const AI_REVIEW_UPGRADE_URL = '/pricing';
