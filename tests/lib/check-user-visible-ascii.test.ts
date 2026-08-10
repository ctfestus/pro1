import { describe, expect, it } from 'vitest';
import { enumerateAllSourcePaths, findUserVisibleNonAscii, parseAddedLines } from '../../scripts/check-user-visible-ascii.mjs';

describe('user-visible ASCII guard', () => {
  it('finds non-ASCII in JSX, strings, and template text but ignores comments, imports, and keys', () => {
    const source = [
      "import x from 'module–name';",
      '// Saving… is discussed here.',
      "const lookup = { 'internal–key': 1 };",
      "const label = 'Saving…';",
      'const view = <span>Score ×0.9</span>;',
      'const message = `Done — ${value}`;',
    ].join('\n');
    const violations = findUserVisibleNonAscii(source, 'components/example.tsx');
    expect(violations.map(item => [item.line, item.character])).toEqual([
      [4, '…'],
      [5, '×'],
      [6, '—'],
    ]);
  });

  it('reports only characters on changed lines', () => {
    const source = "const oldText = 'Old…';\nconst newText = 'New…';\n";
    const violations = findUserVisibleNonAscii(source, 'app/example.ts', new Set([2]));
    expect(violations).toMatchObject([{ line: 2, character: '…' }]);
  });

  it('extracts added destination line numbers from a zero-context diff', () => {
    const patch = [
      'diff --git a/components/a.tsx b/components/a.tsx',
      '--- a/components/a.tsx',
      '+++ b/components/a.tsx',
      '@@ -2,0 +3,2 @@',
      '+const one = 1;',
      '+const two = 2;',
    ].join('\n');
    expect([...parseAddedLines(patch).get('components/a.tsx')!]).toEqual([3, 4]);
  });

  it('enumerates root, nested, and untracked source files while filtering extensions', () => {
    const tracked = [
      'app/page.tsx',
      'app/api/forms/route.ts',
      'components/CourseTaker.tsx',
      'components/lesson/LessonEditor.tsx',
      'lib/email-templates.ts',
      'components/styles.css',
      'README.md',
    ].join('\n');
    const untracked = [
      'components/NewPanel.tsx',
      'lib/new-helper.ts',
      'components/CourseTaker.tsx',
      'app/new-style.css',
    ].join('\n');

    expect([...enumerateAllSourcePaths(tracked, untracked)]).toEqual([
      'app/page.tsx',
      'app/api/forms/route.ts',
      'components/CourseTaker.tsx',
      'components/lesson/LessonEditor.tsx',
      'lib/email-templates.ts',
      'components/NewPanel.tsx',
      'lib/new-helper.ts',
    ]);
  });
});
