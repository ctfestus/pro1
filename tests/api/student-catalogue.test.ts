// The Explore catalogue. Two things are worth pinning here.
//
// 1. The `locked` flag must mirror the database's own access rules. Too strict and a student sees a
//    padlock on something they can already open from My Learning; too loose and the page invites
//    them into content the database will then refuse.
// 2. The projection must never carry course content. This route reads with the service role,
//    bypassing RLS, precisely so it can show locked TITLES -- if `questions` ever joined the select
//    it would be handing out the answers with them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const rows = vi.fn<(table: string) => any[]>(() => []);
  const cohortId = vi.fn<() => string | null>(() => null);
  const requireStudentUser = vi.fn();
  return { rows, cohortId, requireStudentUser };
});

vi.mock('@/lib/api-auth', () => ({
  requireStudentUser: h.requireStudentUser,
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: (table: string) => {
      if (table === 'students') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cohort_id: h.cohortId() }, error: null }) }) }) };
      }
      const data = h.rows(table);
      const result = { data, count: data.length, error: null };
      const page = {
        eq: () => page,
        order: () => page,
        range: async () => result,
        maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
      };
      return { select: () => page };
    },
  }),
}));

import { GET } from '@/app/api/student/catalogue/route';

const request = (query = '') => new NextRequest(`http://localhost/api/student/catalogue${query}`);

async function items() {
  const res = await GET(request());
  const json = await res.json();
  return json.items as any[];
}
const byTitle = (list: any[], title: string) => list.find(i => i.title === title);

beforeEach(() => {
  vi.clearAllMocks();
  h.requireStudentUser.mockResolvedValue({ user: { id: 'student-1' } });
  h.cohortId.mockReturnValue(null);
  h.rows.mockReturnValue([]);
});

describe('GET /api/student/catalogue', () => {
  it('unlocks open content and locks the rest for an account with no cohort', async () => {
    h.rows.mockImplementation((table) => table === 'courses' ? [
      { id: 'c1', title: 'Open course',   cover_image: null, description: null, category: null, cohort_ids: [],           available_to_everyone: true },
      { id: 'c2', title: 'Cohort course', cover_image: null, description: null, category: null, cohort_ids: ['cohort-9'], available_to_everyone: false },
    ] : []);

    const list = await items();

    expect(byTitle(list, 'Open course').locked).toBe(false);
    expect(byTitle(list, 'Cohort course').locked).toBe(true);
  });

  it('unlocks content assigned to the student cohort', async () => {
    h.cohortId.mockReturnValue('cohort-9');
    h.rows.mockImplementation((table) => table === 'virtual_experiences' ? [
      { id: 'v1', title: 'Mine',     cover_image: null, description: null, cohort_ids: ['cohort-9'] },
      { id: 'v2', title: 'Somebody else', cover_image: null, description: null, cohort_ids: ['cohort-3'] },
    ] : []);

    const list = await items();

    expect(byTitle(list, 'Mine').locked).toBe(false);
    expect(byTitle(list, 'Somebody else').locked).toBe(true);
  });

  // The database grants a course through a learning path assigned to the cohort. A padlock on
  // something already open from My Learning would look like a bug to the student.
  it('unlocks a course reachable through a path assigned to the cohort', async () => {
    h.cohortId.mockReturnValue('cohort-9');
    h.rows.mockImplementation((table) => {
      if (table === 'courses') return [
        { id: 'c3', title: 'Via path', cover_image: null, description: null, category: null, cohort_ids: [], available_to_everyone: false },
      ];
      if (table === 'learning_paths') return [
        { id: 'p1', title: 'Path', cover_image: null, description: null, cohort_ids: ['cohort-9'], item_ids: ['c3'] },
      ];
      return [];
    });

    const list = await items();

    expect(byTitle(list, 'Via path').locked).toBe(false);
  });

  it('does not treat a path from another cohort as a grant', async () => {
    h.cohortId.mockReturnValue('cohort-9');
    h.rows.mockImplementation((table) => {
      if (table === 'courses') return [
        { id: 'c4', title: 'Not mine', cover_image: null, description: null, category: null, cohort_ids: [], available_to_everyone: false },
      ];
      if (table === 'learning_paths') return [
        { id: 'p2', title: 'Other path', cover_image: null, description: null, cohort_ids: ['cohort-3'], item_ids: ['c4'] },
      ];
      return [];
    });

    const list = await items();

    expect(byTitle(list, 'Not mine').locked).toBe(true);
  });

  it('unlocks a certification reachable through an assigned learning path', async () => {
    h.cohortId.mockReturnValue('cohort-9');
    h.rows.mockImplementation((table) => {
      if (table === 'certifications') return [
        { id: 'cert-path', title: 'Path certification', cover_image: null, description: null, cohort_ids: [], available_to_everyone: false },
      ];
      if (table === 'learning_paths') return [
        { id: 'p-cert', title: 'Certification path', cover_image: null, description: null, cohort_ids: ['cohort-9'], item_ids: ['cert-path'] },
      ];
      return [];
    });

    const list = await items();

    expect(byTitle(list, 'Path certification').locked).toBe(false);
  });

  // The guard that matters: this route bypasses RLS, so its projection is the only thing standing
  // between a locked course and its answers.
  it('returns display fields only, never course content', async () => {
    h.rows.mockImplementation((table) => table === 'courses' ? [{
      id: 'c5', title: 'Course', cover_image: null, description: null, category: null,
      cohort_ids: [], available_to_everyone: true,
      // Present on the row in reality; must not survive into the response.
      questions: [{ prompt: 'What is 2+2?', correctAnswer: '4' }],
    }] : []);

    const list = await items();

    expect(Object.keys(list[0]).sort()).toEqual(
      ['category', 'coverImage', 'description', 'id', 'locked', 'slug', 'title', 'type'],
    );
    expect(JSON.stringify(list)).not.toContain('correctAnswer');
  });

  it('returns display fields only for learning path items', async () => {
    h.rows.mockImplementation((table) => {
      if (table === 'courses') return [{
        id: 'c6', title: 'Nested course', slug: 'nested-course', cover_image: 'course.jpg', description: null, category: 'AI',
        cohort_ids: [], available_to_everyone: false,
        questions: [{ prompt: 'Hidden prompt', correctAnswer: 'Hidden answer' }],
      }];
      if (table === 'virtual_experiences') return [{
        id: 'v6', title: 'Nested VE', slug: 'nested-ve', cover_image: 've.jpg', description: null,
        cohort_ids: [],
        scenario: { answerKey: 'Hidden VE answer' },
      }];
      if (table === 'learning_paths') return [{
        id: 'p6', title: 'Path', cover_image: null, description: null, cohort_ids: [], item_ids: ['c6', 'v6'],
      }];
      return [];
    });

    const list = await items();
    const path = byTitle(list, 'Path');

    expect(path.pathItems.map((item: any) => Object.keys(item).sort())).toEqual([
      ['coverImage', 'id', 'slug', 'title', 'type'],
      ['coverImage', 'id', 'slug', 'title', 'type'],
    ]);
    expect(path.pathItems).toEqual([
      { id: 'c6', type: 'course', title: 'Nested course', slug: 'nested-course', coverImage: 'course.jpg' },
      { id: 'v6', type: 'virtual_experience', title: 'Nested VE', slug: 'nested-ve', coverImage: 've.jpg' },
    ]);
    expect(JSON.stringify(path.pathItems)).not.toContain('Hidden answer');
    expect(JSON.stringify(path.pathItems)).not.toContain('Hidden VE answer');
  });

  it('returns one safe item when a detail route requests a catalogue preview', async () => {
    h.rows.mockImplementation((table) => table === 'courses' ? [{
      id: 'c7', title: 'Locked course', slug: 'locked-course', cover_image: 'cover.jpg',
      description: 'Overview', category: 'Data', cohort_ids: ['another-cohort'],
      available_to_everyone: false,
      questions: [
        { id: 'section-1', isSection: true, sectionTitle: 'Foundations' },
        { id: 'lesson-1', lesson: { title: 'Introduction', body: 'Hidden lesson body' }, correctAnswer: 'secret' },
      ],
    }] : []);

    const res = await GET(request('?ref=locked-course&type=course'));
    const { item } = await res.json();

    expect(item).toEqual({
      id: 'c7', type: 'course', title: 'Locked course', slug: 'locked-course',
      coverImage: 'cover.jpg', description: 'Overview', category: 'Data', locked: true,
      outline: [
        { id: 'section-1', type: 'section', title: 'Foundations' },
        { id: 'lesson-1', type: 'lesson', title: 'Introduction' },
      ],
    });
    expect(JSON.stringify(item)).not.toContain('secret');
    expect(JSON.stringify(item)).not.toContain('Hidden lesson body');
  });

  it('refuses an unauthenticated caller', async () => {
    h.requireStudentUser.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });

    const res = await GET(request());

    expect(res.status).toBe(401);
  });
});
