// The learner count on a public page: only for an item the page already shows the public, only
// from 50 up, and a failed count hides the figure rather than breaking the page.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  found: null as any,
  rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: 0 as unknown, error: null as any })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/content-share-metadata', () => ({ findSharedItem: async () => h.found }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => ({ rpc: h.rpc }) }));

import { loadLearnerCount } from '@/lib/content-learner-count';

const item = (type: string) => ({ type, record: { id: 'item-1' }, locked: true, plans: [] });

describe('loadLearnerCount', () => {
  beforeEach(() => {
    h.found = null;
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: 0, error: null });
  });

  it('counts a public course by its table and id', async () => {
    h.found = item('course');
    h.rpc.mockResolvedValue({ data: 1240, error: null });
    await expect(loadLearnerCount('sql-basics', 'course')).resolves.toBe(1240);
    expect(h.rpc).toHaveBeenCalledWith('content_learner_count', { p_table: 'courses', p_id: 'item-1' });
  });

  it('uses the path and experience tables', async () => {
    h.rpc.mockResolvedValue({ data: 80, error: null });
    h.found = item('learning_path');
    await loadLearnerCount('p', 'learning_path');
    h.found = item('virtual_experience');
    await loadLearnerCount('v', 'virtual_experience');
    expect(h.rpc.mock.calls.map(call => call[1].p_table)).toEqual(['learning_paths', 'virtual_experiences']);
  });

  it('shows nothing below 50', async () => {
    h.found = item('course');
    h.rpc.mockResolvedValue({ data: 49, error: null });
    await expect(loadLearnerCount('c', 'course')).resolves.toBeNull();
    h.rpc.mockResolvedValue({ data: 50, error: null });
    await expect(loadLearnerCount('c', 'course')).resolves.toBe(50);
  });

  it('never counts an item the public cannot see, or a certification', async () => {
    await expect(loadLearnerCount('hidden', 'course')).resolves.toBeNull();
    h.found = item('certification');
    await expect(loadLearnerCount('cert', 'certification')).resolves.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('hides the figure when the count fails', async () => {
    h.found = item('course');
    h.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadLearnerCount('c', 'course')).resolves.toBeNull();
    log.mockRestore();
  });
});
