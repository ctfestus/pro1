// What the pricing page claims a plan includes.
//
// The risk here is a promise a visitor can check and find wrong: an exact count is stale the
// moment a course is published or retired, and someone who counts 23 after reading "24" has
// caught the platform being careless.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { band, planBenefits } from '@/lib/pricing-benefits';
import { emptyContentCounts } from '@/lib/pricing-contract';

const counts = (over: Partial<ReturnType<typeof emptyContentCounts>>) =>
  ({ ...emptyContentCounts(), ...over });

describe('band', () => {
  it('rounds down, so the claim stays true as the catalogue grows', () => {
    expect(band(24)).toBe('20+');
    expect(band(20)).toBe('20+');
    expect(band(99)).toBe('90+');
  });

  it('says nothing rather than rounding a small number up', () => {
    // "10+" from four courses would be a lie, and "0+" is nonsense.
    expect(band(9)).toBeNull();
    expect(band(4)).toBeNull();
    expect(band(0)).toBeNull();
  });
});

describe('planBenefits', () => {
  it('describes what is included without quoting a count', () => {
    const lines = planBenefits(counts({
      courses: 24, learning_paths: 3, virtual_experiences: 2, certifications: 1,
    }));
    expect(lines).toEqual([
      'Full access to 20+ courses',
      'Full access to learning paths',
      'Access to virtual experiences',
      'Access to certifications',
    ]);
    // No exact figure anywhere: 24, 3, 2 and 1 must not reach the page.
    expect(lines.join(' ')).not.toMatch(/\b24\b|\b3\b|\b2\b|\b1\b/);
  });

  it('claims a kind on a single item, since one is still included', () => {
    const lines = planBenefits(counts({ learning_paths: 1, certifications: 1 }));
    expect(lines).toEqual([
      'Full access to learning paths',
      'Access to certifications',
    ]);
  });

  it('drops a kind the plan does not include at all', () => {
    expect(planBenefits(counts({ courses: 12 }))).toEqual(['Full access to 10+ courses']);
    expect(planBenefits(emptyContentCounts())).toEqual([]);
  });

  it('avoids a bare number when there are only a few courses', () => {
    expect(planBenefits(counts({ courses: 4 }))).toEqual(['Full access to every course']);
  });
});

describe('the comparison table', () => {
  it('shows inclusion, never a quantity', () => {
    // A tick or a dash. Rendering the count again here would reintroduce exactly the promise
    // the wording above is written to avoid.
    const section = readFileSync(
      join(process.cwd(), 'components/pricing/PricingSection.tsx'),
      'utf8',
    );
    const table = section.slice(section.indexOf('function ComparisonTable'));
    expect(table).toContain('includes(column.key, kind)');
    expect(table).not.toMatch(/\{\s*(plan\.)?coverage\[kind\]\s*\}/);
    expect(table).not.toMatch(/\{\s*free\[kind\]\s*\}/);
  });
});
