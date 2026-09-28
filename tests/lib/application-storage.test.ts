import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({ storage: { from: () => ({ info: mocks.info }) } }),
}));

import { newApplicationFormConfig } from '@/lib/application-forms';
import { applicationQuestionFilePrefix, normalizeApplicationStorageAnswers } from '@/lib/application-storage';

const form = {
  id: 'form-1', config: {
    ...newApplicationFormConfig(),
    questions: [{ id: 'cv', label: 'CV', type: 'file' as const, required: true }],
  },
};
const fileName = `${applicationQuestionFilePrefix('cv')}-12345678-1234-1234-1234-123456789abc.pdf`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.info.mockResolvedValue({ data: { size: 6500000, contentType: 'application/pdf' }, error: null });
});

describe('private application uploads', () => {
  it('checks the actual stored object before accepting an answer', async () => {
    const answer = {
      url: 'https://untrusted.example/file',
      publicId: `supabase/form-1/submission-1/${fileName}`,
      name: 'cv.pdf', size: 1, type: 'application/pdf',
    };
    const result = await normalizeApplicationStorageAnswers(form as any, 'submission-1', { cv: answer });
    expect(result.errors).toEqual({});
    expect(result.answers.cv).toEqual({ ...answer, url: '', size: 6500000 });
    expect(mocks.info).toHaveBeenCalledWith(`form-1/submission-1/${fileName}`);
  });

  it('rejects a file belonging to another submission', async () => {
    const result = await normalizeApplicationStorageAnswers(form as any, 'submission-1', {
      cv: { url: '', publicId: `supabase/form-1/other-submission/${fileName}`, name: 'cv.pdf', size: 1, type: 'application/pdf' },
    });
    expect(result.errors.cv).toContain('valid file');
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('rejects a file uploaded for another question on the same submission', async () => {
    const otherName = `${applicationQuestionFilePrefix('portfolio')}-12345678-1234-1234-1234-123456789abc.pdf`;
    const result = await normalizeApplicationStorageAnswers(form as any, 'submission-1', {
      cv: { url: '', publicId: `supabase/form-1/submission-1/${otherName}`, name: 'cv.pdf', size: 1, type: 'application/pdf' },
    });
    expect(result.errors.cv).toContain('valid file');
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
