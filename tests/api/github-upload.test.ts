import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ requireRole: vi.fn() }));

vi.mock('@/lib/api-auth', () => ({
  requireRole: authState.requireRole,
  isAuthError: (value: any) => value?.error instanceof NextResponse,
}));

import { POST } from '@/app/api/assignments/github-upload/route';

function request(file: File, folder?: string) {
  const body = new FormData();
  body.append('file', file);
  if (folder) body.append('folder', folder);
  return new NextRequest('http://localhost/api/assignments/github-upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer token' },
    body,
  });
}

function auth(role: string, userId = 'teacher-1') {
  return {
    user: { id: userId, email: `${userId}@example.com` },
    role,
    serviceDb: {},
    token: 'token',
    isStudentMode: false,
  };
}

describe('assignment GitHub upload route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authState.requireRole.mockReset();
    process.env.GITHUB_TOKEN = 'gh-token';
    process.env.GITHUB_REPO_OWNER = 'owner';
    process.env.GITHUB_REPO_NAME = 'repo';
    process.env.GITHUB_REPO_BRANCH = 'main';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: { sha: 'sha-1' } }), { status: 200 }),
    );
  });

  it('lets instructors upload VE email attachments to GitHub', async () => {
    authState.requireRole.mockResolvedValue(auth('instructor'));
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'template.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const response = await POST(request(file, 've-email-attachments'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.url).toContain('/owner/repo/main/ve-email-attachments/');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body)).content).toBe(Buffer.from([80, 75, 3, 4]).toString('base64'));
  });

  it('lets instructors upload raw VE datasets to GitHub', async () => {
    authState.requireRole.mockResolvedValue(auth('instructor'));
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'analysis.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const response = await POST(request(file, 've-datasets'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.url).toContain('/owner/repo/main/ve-datasets/');
  });

  it('accepts legacy Excel workbooks for instructor VE uploads', async () => {
    authState.requireRole.mockResolvedValue(auth('instructor'));
    const file = new File(['legacy workbook'], 'analysis.xls', { type: 'application/vnd.ms-excel' });

    const response = await POST(request(file, 've-datasets'));

    expect(response.status).toBe(200);
  });

  it('blocks students from uploading into the GitHub-backed folders', async () => {
    authState.requireRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const file = new File(['answer'], 'analysis.xlsx');

    const response = await POST(request(file, 've-datasets'));

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
