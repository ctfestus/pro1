import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/ai', () => ({
  generateJSON: vi.fn(),
  generateVisionJSON: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { generateJSON, generateVisionJSON } from '@/lib/ai';
import { POST } from '@/app/api/extract-rubric/route';

const mockRequireRole = vi.mocked(requireRole);
const mockGenerateJSON = vi.mocked(generateJSON);
const mockGenerateVisionJSON = vi.mocked(generateVisionJSON);

function postFile(file: File, label: string): Promise<Response> {
  const body = new FormData();
  body.append('file', file);
  body.append('label', label);
  return POST(new Request('http://localhost/api/extract-rubric', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body,
  }) as any) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ user: { id: 'u1' }, role: 'instructor' } as any);
});

describe('POST /api/extract-rubric - Markdown rubric import', () => {
  it('treats Markdown rubric criteria as authoritative and normalizes the result', async () => {
    mockGenerateJSON.mockResolvedValue({
      criteria: [' Accuracy is at least 95% ', 'accuracy is at least 95%', 'Explains every REVIEW result'],
    });

    const response = await postFile(
      new File(['# Rubric\n- Accuracy is at least 95%'], 'grading-rubric.md', { type: 'text/markdown' }),
      'rubric',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      criteria: ['Accuracy is at least 95%', 'Explains every REVIEW result'],
    });
    expect(mockGenerateJSON).toHaveBeenCalledTimes(1);
    const prompt = String(mockGenerateJSON.mock.calls[0][0]);
    expect(prompt).toContain('Treat the rubric as authoritative data');
    expect(prompt).toContain('Do not invent requirements');
    expect(prompt).toContain('Rubric Markdown JSON string:');
    expect(mockGenerateVisionJSON).not.toHaveBeenCalled();
  });

  it('rejects a non-Markdown file for direct rubric import', async () => {
    const response = await postFile(new File(['criterion'], 'rubric.txt', { type: 'text/plain' }), 'rubric');
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Rubric imports must be Markdown (.md) files' });
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('rejects a Markdown rubric over the import size limit', async () => {
    const response = await postFile(
      new File(['a'.repeat(200_001)], 'rubric.md', { type: 'text/markdown' }),
      'rubric',
    );
    expect(response.status).toBe(413);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('rejects an unsupported extraction type', async () => {
    const response = await postFile(new File(['criterion'], 'rubric.md', { type: 'text/markdown' }), 'instructions');
    expect(response.status).toBe(400);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('keeps reference-solution extraction as an inference workflow', async () => {
    mockGenerateJSON.mockResolvedValue({ criteria: ['Uses accurate calculations'] });
    const response = await postFile(
      new File(['completed analysis'], 'solution.txt', { type: 'text/plain' }),
      'reference_solution',
    );
    expect(response.status).toBe(200);
    const prompt = String(mockGenerateJSON.mock.calls[0][0]);
    expect(prompt).toContain('completed reference solution file');
    expect(prompt).not.toContain('Treat the rubric as authoritative data');
  });
});
