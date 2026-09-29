import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), listForms: vi.fn(), reviewerFormIds: vi.fn(), countByForm: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireRole: mocks.requireRole, isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/application-form-store', () => ({ listApplicationForms: mocks.listForms, saveApplicationForm: vi.fn() }));
vi.mock('@/lib/application-submissions', () => ({
  appendApplicationAudit: vi.fn(),
  listApplicationFormIdsForReviewer: mocks.reviewerFormIds,
  countSubmittedApplicationsByForm: mocks.countByForm,
}));

import { GET } from '@/app/api/application-forms/route';

const form = (id: string, ownerId: string) => ({ id, ownerId, slug: id, status: 'published', config: { title: id } });
const FORMS = [form('form-a', 'owner-1'), form('form-b', 'owner-2'), form('form-c', 'owner-1')];
const listForms = () => GET(new NextRequest('http://localhost/api/application-forms'));
const as = (role: string, id = 'user-1') => mocks.requireRole.mockResolvedValue({ role, actor: { id, email: `${id}@example.com` } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listForms.mockResolvedValue(FORMS);
  mocks.countByForm.mockImplementation(async (ids: string[]) => Object.fromEntries(ids.map(id => [id, 5])));
});

describe('GET /api/application-forms counts', () => {
  it('gives admins every form and counts them all, without a reviewer filter', async () => {
    as('admin');
    const body = await (await listForms()).json();
    expect(body.forms.map((item: any) => item.id)).toEqual(['form-a', 'form-b', 'form-c']);
    expect(mocks.countByForm).toHaveBeenCalledOnce();
    expect(mocks.countByForm).toHaveBeenCalledWith(['form-a', 'form-b', 'form-c'], undefined);
    expect(body.submissionCounts).toEqual({ 'form-a': 5, 'form-b': 5, 'form-c': 5 });
  });

  it('counts only the forms an instructor owns', async () => {
    as('instructor', 'owner-1');
    const body = await (await listForms()).json();
    expect(body.forms.map((item: any) => item.id)).toEqual(['form-a', 'form-c']);
    expect(mocks.countByForm).toHaveBeenCalledWith(['form-a', 'form-c'], undefined);
  });

  it('counts only a reviewer\'s assigned applications on their assigned forms', async () => {
    as('staff', 'reviewer-9');
    mocks.reviewerFormIds.mockResolvedValue(['form-b']);
    const body = await (await listForms()).json();
    expect(mocks.reviewerFormIds).toHaveBeenCalledWith('reviewer-9');
    expect(body.forms.map((item: any) => item.id)).toEqual(['form-b']);
    expect(mocks.countByForm).toHaveBeenCalledWith(['form-b'], 'reviewer-9');
  });

  it('still returns the forms, without totals, when counting fails', async () => {
    as('admin');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.countByForm.mockRejectedValue(new Error('Could not count applications: function does not exist'));
    const response = await listForms();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.forms).toHaveLength(3);
    expect(body).not.toHaveProperty('submissionCounts');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
