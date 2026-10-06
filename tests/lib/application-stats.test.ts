import { describe, expect, it } from 'vitest';
import { DEFAULT_APPLICATION_STAGES, type ApplicationAnswer } from '@/lib/application-forms';
import { applicationFieldBreakdowns, applicationOverview } from '@/lib/application-stats';

// Local-time constructors so the day buckets match regardless of the test machine's zone.
const at = (day: number, hour = 10) => new Date(2026, 8, day, hour).toISOString();
const NOW = new Date(2026, 8, 29, 15);
const submission = (day: number, stageId = 'submitted') => ({ submittedAt: at(day), stageId });

describe('application insights', () => {
  it('counts totals, today, the last 7 days, and 30 local-day buckets ending today', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [
      // Day -10 is 21 August: before the 30-day window (31 Aug to 29 Sep).
      submission(29), submission(29), submission(25), submission(23), submission(22), submission(-10),
    ], NOW);
    expect(overview.total).toBe(6);
    expect(overview.today).toBe(2);
    expect(overview.last7Days).toBe(4);
    expect(overview.daily).toHaveLength(30);
    expect(overview.daily[29]).toEqual({ date: '2026-09-29', count: 2 });
    expect(overview.daily[0].date).toBe('2026-08-31');
    expect(overview.daily.reduce((sum, day) => sum + day.count, 0)).toBe(5);
  });

  it('lists every stage in order and groups applicants in removed stages as Other', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [
      submission(28, 'screening'), submission(28, 'accepted'), submission(27), submission(27, 'gone-stage'),
    ], NOW);
    expect(overview.byStage.map(stage => stage.id)).toEqual([...DEFAULT_APPLICATION_STAGES.map(stage => stage.id), '']);
    expect(overview.byStage.find(stage => stage.id === 'screening')?.count).toBe(1);
    expect(overview.byStage.find(stage => stage.id === 'submitted')?.count).toBe(1);
    expect(overview.byStage.at(-1)).toEqual({ id: '', name: 'Other', count: 1 });
  });

  it('returns zeros and an empty chart for a form with no applications', () => {
    const overview = applicationOverview(DEFAULT_APPLICATION_STAGES, [], NOW);
    expect(overview).toMatchObject({ total: 0, today: 0, last7Days: 0 });
    expect(overview.daily.every(day => day.count === 0)).toBe(true);
    expect(overview.byStage.every(stage => stage.count === 0)).toBe(true);
  });
});

describe('answers by question', () => {
  it('counts Other selections as one option while keeping typed details private to each answer', () => {
    const fields = applicationFieldBreakdowns([
      { id: 'track', label: 'Track', type: 'single_choice', required: false, options: ['Data', 'Design'], allowOther: true },
      { id: 'skills', label: 'Skills', type: 'multiple_choice', required: false, options: ['SQL', 'Python'], allowOther: true },
    ], [{ answers: { track: { kind: 'other_choice', selections: ['Other (please specify)'], otherText: 'Research' }, skills: { kind: 'other_choice', selections: ['SQL', 'Other (please specify)'], otherText: 'Power BI' } } }]);
    expect(fields[0]).toMatchObject({ kind: 'choice', answered: 1, options: expect.arrayContaining([{ label: 'Other (please specify)', count: 1, share: 1 }]) });
    expect(fields[1]).toMatchObject({ kind: 'multi', answered: 1, options: expect.arrayContaining([{ label: 'Other (please specify)', count: 1, share: 1 }]) });
  });
  const q = (id: string, type: any, extra: Record<string, unknown> = {}) => ({ id, label: id, type, required: false, ...extra });
  const questions = [
    q('gender', 'single_choice', { options: ['Female', 'Male', 'Prefer not to say'] }),
    q('tools', 'multiple_choice', { options: ['Excel', 'SQL', 'Power BI'] }),
    q('location', 'short_text'),
    q('name', 'short_text'),
    q('age', 'number'),
    q('laptop', 'yes_no'),
    q('intro', 'text_block', { richText: '<p>Hi</p>' }),
    q('bio', 'long_text'),
    q('employer', 'short_text', { condition: { questionId: 'laptop', operator: 'equals', value: 'Yes' } }),
  ];
  const people: { answers: Record<string, ApplicationAnswer> }[] = [
    { answers: { gender: 'Female', tools: ['Excel', 'SQL'], location: 'Accra', name: 'Ama', age: 24, laptop: 'Yes', employer: 'Acme' } },
    { answers: { gender: 'Female', tools: ['Excel'], location: ' accra ', name: 'Esi', age: 30, laptop: 'Yes', employer: 'acme' } },
    { answers: { gender: 'Male', tools: ['SQL', 'Power BI'], location: 'Kumasi', name: 'Kofi', age: 27, laptop: 'No' } },
    { answers: { gender: 'Other old option', tools: [], location: '', name: 'Yaw' } },
  ];
  const byId = Object.fromEntries(applicationFieldBreakdowns(questions as any, people).map(field => [field.id, field]));

  it('counts single choices with shares of those who answered, keeping removed options', () => {
    const gender = byId.gender as any;
    expect(gender).toMatchObject({ kind: 'choice', answered: 4, shown: 4 });
    expect(gender.options).toEqual([
      { label: 'Female', count: 2, share: 0.5 },
      { label: 'Male', count: 1, share: 0.25 },
      { label: 'Prefer not to say', count: 0, share: 0 },
      { label: 'Other old option', count: 1, share: 0.25 },
    ]);
  });

  it('counts each checkbox option once per applicant, so shares can pass 100%', () => {
    const tools = byId.tools as any;
    expect(tools).toMatchObject({ kind: 'multi', answered: 3 });
    expect(tools.options.map((option: any) => [option.label, option.count])).toEqual([['Excel', 2], ['SQL', 2], ['Power BI', 1]]);
    expect(tools.options.reduce((sum: number, option: any) => sum + option.share, 0)).toBeGreaterThan(1);
  });

  it('groups short answers ignoring case and spacing, and skips questions where every answer differs', () => {
    const location = byId.location as any;
    expect(location).toMatchObject({ kind: 'text', answered: 3 });
    expect(location.options[0]).toMatchObject({ label: 'Accra', count: 2 });
    expect(byId.name).toBeUndefined();
  });

  it('summarises numbers and yes or no questions, and counts conditional questions against who saw them', () => {
    expect(byId.age).toMatchObject({ kind: 'number', answered: 3, average: 27, min: 24, max: 30 });
    expect((byId.laptop as any).options).toEqual([{ label: 'Yes', count: 2, share: 2 / 3 }, { label: 'No', count: 1, share: 1 / 3 }]);
    expect(byId.employer).toMatchObject({ kind: 'text', answered: 2, shown: 2 });
  });

  it('leaves out content blocks and question types that do not summarise', () => {
    expect(byId.intro).toBeUndefined();
    expect(byId.bio).toBeUndefined();
  });

  it('groups text answers beyond the most common eight as other answers', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ answers: { location: `City ${index}` } }));
    const repeated = [...many, { answers: { location: 'City 0' } }];
    const field = applicationFieldBreakdowns([q('location', 'short_text')] as any, repeated)[0] as any;
    expect(field.options).toHaveLength(8);
    expect(field.otherCount).toBe(2);
  });
});
