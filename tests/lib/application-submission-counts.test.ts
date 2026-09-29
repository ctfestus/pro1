import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/application-form-store', () => ({ getApplicationForm: vi.fn() }));

import { countSubmittedApplicationsByForm } from '@/lib/application-submissions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countSubmittedApplicationsByForm', () => {
  it('counts in one database call and fills forms without submissions with zero', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ form_id: 'form-a', total: 12 }, { form_id: 'form-c', total: '3' }], error: null });
    const counts = await countSubmittedApplicationsByForm(['form-a', 'form-b', 'form-c']);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('count_submitted_applications_by_form', { p_form_ids: ['form-a', 'form-b', 'form-c'], p_reviewer_id: null });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(counts).toEqual({ 'form-a': 12, 'form-b': 0, 'form-c': 3 });
  });

  it('passes the reviewer so only their assigned applications are counted', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await countSubmittedApplicationsByForm(['form-a'], 'reviewer-uuid');
    expect(mocks.rpc).toHaveBeenCalledWith('count_submitted_applications_by_form', { p_form_ids: ['form-a'], p_reviewer_id: 'reviewer-uuid' });
  });

  it('sends a large list of forms in a single call', async () => {
    const formIds = Array.from({ length: 1500 }, (_, index) => `form-${index}`);
    mocks.rpc.mockResolvedValue({ data: [{ form_id: 'form-1499', total: 2 }], error: null });
    const counts = await countSubmittedApplicationsByForm(formIds);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(Object.keys(counts)).toHaveLength(1500);
    expect(counts['form-1499']).toBe(2);
  });

  it('ignores rows for forms that were not requested and bad totals', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ form_id: 'toString', total: 9 }, { form_id: 'form-a', total: 'n/a' }], error: null });
    expect(await countSubmittedApplicationsByForm(['form-a'])).toEqual({ 'form-a': 0 });
  });

  it('skips the database for an empty list and reports database errors', async () => {
    expect(await countSubmittedApplicationsByForm([])).toEqual({});
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    await expect(countSubmittedApplicationsByForm(['form-a'])).rejects.toThrow('Could not count applications: function does not exist');
  });
});
