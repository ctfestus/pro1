/**
 * What a plan grants, said in words rather than in figures.
 *
 * A pricing page that reads "24 courses" makes a promise a visitor can sit down and check, and
 * it is wrong the moment a course is added or retired. A band survives that; a plain statement
 * of what is included survives it better still.
 */
import type { ContentCounts } from '@/lib/pricing-contract';

/**
 * A rounded-down band, or nothing when the number is too small to band honestly.
 * Twelve courses becomes "10+"; four becomes nothing at all, because "0+" is nonsense and
 * rounding four up to ten would be a lie.
 */
export function band(count: number): string | null {
  if (!Number.isFinite(count) || count < 10) return null;
  return `${Math.floor(count / 10) * 10}+`;
}

/** One line per kind the plan actually includes, in the order a buyer cares about. */
export function planBenefits(coverage: ContentCounts): string[] {
  const lines: string[] = [];
  if (coverage.courses > 0) {
    const size = band(coverage.courses);
    lines.push(size ? `Full access to ${size} courses` : 'Full access to every course');
  }
  if (coverage.learning_paths > 0) lines.push('Full access to learning paths');
  if (coverage.virtual_experiences > 0) lines.push('Access to virtual experiences');
  if (coverage.certifications > 0) lines.push('Access to certifications');
  return lines;
}
