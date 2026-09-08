import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('public content access parity', () => {
  const veProgress = read('app/api/guided-project-progress/route.ts');
  const course = read('app/api/course/route.ts');
  const pathProgress = read('lib/learning-path-progress.ts');
  const overview = read('components/student/overview.tsx');
  const myLearningVes = read('components/student/virtual-experiences.tsx');

  it('uses the shared public and path grant for courses and both VE gates', () => {
    expect(course).toContain('hasPublishedStudentContentAccess');
    expect(veProgress.match(/hasPublishedStudentContentAccess/g)).toHaveLength(3);
    expect(veProgress).toContain("select('status, cohort_ids, available_to_everyone, modules, title, slug')");
    expect(veProgress).toContain("select('status, cohort_ids, available_to_everyone')");
  });

  it('updates public learning paths for learners without a cohort', () => {
    expect(pathProgress).toContain("pathQuery.eq('available_to_everyone', true)");
    expect(pathProgress).not.toContain('if (!student?.cohort_id) return');
  });

  it('shows public virtual experiences in the overview with or without a cohort', () => {
    expect(overview).toContain("from('virtual_experiences').select('id, title, slug, cover_image, modules, deadline_days').or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohort}}`)");
    expect(overview).toContain("from('virtual_experiences').select('id, title, slug, cover_image, modules, deadline_days').eq('available_to_everyone', true)");
  });

  it('loads public and attempted virtual experiences in My Learning without a cohort', () => {
    expect(myLearningVes).not.toContain('if (!profile?.cohort_id)');
    expect(myLearningVes).toContain(".eq('available_to_everyone', true)");
    expect(myLearningVes).toContain(".from('guided_project_attempts')");
  });
});
