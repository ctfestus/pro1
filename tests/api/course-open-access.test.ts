import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('course open access is explicit', () => {
  const courseRoute = read('app/api/course/route.ts');
  const formsRoute = read('app/api/forms/route.ts');
  const editor = read('components/FormEditor.tsx');
  const createEditor = read('app/create/page.tsx');
  const catalog = read('components/student/courses-paths.tsx');
  const overview = read('components/student/overview.tsx');
  const migration = read('migrations/174_available_to_everyone.sql');
  const schema = read('festman-fresh-schema.sql');

  it('never grants direct access from an empty cohort list', () => {
    expect(courseRoute).toContain('const cohortAllowed = (course as any).available_to_everyone === true');
    expect(courseRoute).not.toMatch(/cohortIds\.length === 0 \|\|/);
    expect(courseRoute).toContain("select.includes('available_to_everyone')");
  });

  it('persists an explicit Everyone choice in course authoring', () => {
    expect(editor).toContain("setCourseAvailableToEveryone(course.available_to_everyone === true)");
    expect(editor).toContain("available_to_everyone: courseAvailableToEveryone");
    expect(formsRoute).toContain('available_to_everyone: courseAvailableToEveryone');
    expect(formsRoute).toContain('courseAvailableToEveryone ? []');
    expect(formsRoute).toContain('isCourse && available_to_everyone === true ? []');
    expect(formsRoute).toContain('submittedCourseCohorts ? false');
    expect(createEditor).toContain('const [courseAvailableToEveryone, setCourseAvailableToEveryone] = useState(false)');
    expect(createEditor).toContain('available_to_everyone: courseAvailableToEveryone');
    expect(createEditor).toContain('Nobody can access this yet. Choose Everyone or select at least one cohort.');
    expect(createEditor).not.toContain('No cohort selected -- course will be public.');
  });

  it('includes explicit global courses in both student discovery surfaces', () => {
    expect(catalog).toContain('available_to_everyone.eq.true,cohort_ids.cs.');
    expect(overview).toContain('available_to_everyone.eq.true,cohort_ids.cs.');
  });

  it('does not backfill unassigned courses as global', () => {
    expect(migration).not.toMatch(/UPDATE public\.courses/);
    expect(migration).toContain("status = 'published' AND available_to_everyone");
    expect(migration).toContain('courses_everyone_has_no_cohorts');
    expect(migration).toContain("conname = 'courses_everyone_has_no_cohorts'");
    expect(migration).toContain("conname = 'certifications_everyone_has_no_cohorts'");
    const coursePolicy = schema.slice(
      schema.indexOf('CREATE POLICY "courses: participants select"'),
      schema.indexOf('CREATE POLICY', schema.indexOf('CREATE POLICY "courses: participants select"') + 20),
    );
    expect(coursePolicy).toContain("status = 'published' AND available_to_everyone");
  });
});
