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

  it('rejects a renamed binary file with a conflicting MIME type', async () => {
    const response = await postFile(
      new File(['%PDF-1.7'], 'rubric.md', { type: 'application/pdf' }),
      'rubric',
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Rubric imports must contain Markdown text' });
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('rejects binary content disguised with a generic MIME type', async () => {
    const response = await postFile(
      new File([new Uint8Array([0, 1, 2, 3])], 'rubric.md', { type: 'application/octet-stream' }),
      'rubric',
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Rubric imports must contain valid UTF-8 Markdown text' });
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('asks for retries so one busy moment does not end the import', async () => {
    mockGenerateJSON.mockResolvedValue({ criteria: ['Accuracy is at least 95%'] });
    await postFile(new File(['# Rubric heading', '- Accuracy is at least 95%'], 'rubric.md', { type: 'text/markdown' }), 'rubric');
    expect(mockGenerateJSON.mock.calls[0][2]).toMatchObject({ geminiRetries: 2 });
  });

  it('says the AI service is busy rather than blaming the file', async () => {
    mockGenerateJSON.mockRejectedValue(new Error(JSON.stringify({
      error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' },
    })));

    const response = await postFile(new File(['# Rubric heading', '- Accuracy is at least 95%'], 'rubric.md', { type: 'text/markdown' }), 'rubric');

    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error).toContain('Your file is fine');
  });

  it('still reports an unusable file as an extraction failure', async () => {
    mockGenerateJSON.mockRejectedValue(new Error('Unexpected token in JSON'));

    const response = await postFile(new File(['# Rubric heading', '- Accuracy is at least 95%'], 'rubric.md', { type: 'text/markdown' }), 'rubric');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to extract rubric from file' });
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
