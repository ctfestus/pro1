export function shouldShowGroupReadyScreen(input: {
  graded: boolean;
  canSubmit: boolean;
  overallPct: number;
  reviewBeforeSubmit: boolean;
}): boolean {
  return !input.graded && !input.canSubmit && input.overallPct >= 100 && !input.reviewBeforeSubmit;
}
