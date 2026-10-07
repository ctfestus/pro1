import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

vi.mock('@/lib/api-auth', () => ({ requireUser: vi.fn(), isAuthError: (value: any) => !!value?.error }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));
vi.mock('@/lib/ai-feature-gate', () => ({ chargeAiFeature: vi.fn(), refundAiFeature: vi.fn() }));
vi.mock('@/lib/ai', () => ({ generateJSON: vi.fn(), generateVisionJSON: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { chargeAiFeature, refundAiFeature } from '@/lib/ai-feature-gate';
import { generateJSON, generateVisionJSON } from '@/lib/ai';
import { POST } from '@/app/api/document-review/route';

async function post(file: File) {
  const body = new FormData();
  body.append('file', file);
  return POST(new Request('http://localhost/api/document-review', { method: 'POST', body }) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ user: { id: 'student' }, role: 'student' } as any);
  vi.mocked(chargeAiFeature).mockResolvedValue({ receipt: { id: 'charged' } } as any);
  vi.mocked(generateJSON).mockResolvedValue({ overallScore: 85 });
  vi.mocked(generateVisionJSON).mockResolvedValue({ overallScore: 85 });
});

describe('document review input conversion', () => {
  it('extracts DOCX text using the existing guarded extractor', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:p><w:r><w:t>Business report &amp; analysis</w:t></w:r></w:p></w:document>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    expect((await post(new File([bytes as BlobPart], 'report.docx'))).status).toBe(200);
    expect(vi.mocked(generateJSON).mock.calls[0][0]).toContain('Business report & analysis');
    expect(vi.mocked(generateJSON).mock.calls[0][2]).toMatchObject({ feature: 'document-review', noFallback: true, retries: 1 });
    expect(generateVisionJSON).not.toHaveBeenCalled();
  });

  it('sends plain text as text, and PDFs as native documents', async () => {
    expect((await post(new File(['Report body'], 'report.txt'))).status).toBe(200);
    expect(vi.mocked(generateJSON).mock.calls[0][0]).toContain('Report body');
    expect((await post(new File(['%PDF-fixture'], 'report.pdf'))).status).toBe(200);
    expect(vi.mocked(generateVisionJSON).mock.calls[0][1].mimeType).toBe('application/pdf');
  });

  it('refunds unusable DOCX inputs without calling an AI', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await post(new File(['not a ZIP'], 'broken.docx'))).status).toBe(503);
      expect(generateJSON).not.toHaveBeenCalled();
      expect(generateVisionJSON).not.toHaveBeenCalled();
      expect(refundAiFeature).toHaveBeenCalledTimes(1);
    } finally { errorLog.mockRestore(); }
  });

  it('warns about partial TXT reviews and does not send the omitted tail', async () => {
    const response = await post(new File(['a'.repeat(300_000) + 'OMITTED_TAIL'], 'long.txt'));
    expect(response.status).toBe(200);
    expect((await response.json()).warning).toContain('remaining content was not assessed');
    expect(vi.mocked(generateJSON).mock.calls[0][0]).not.toContain('OMITTED_TAIL');
    const boundary = await post(new File(['a'.repeat(300_000)], 'limit.txt'));
    expect((await boundary.json()).warning).toContain('first 300,000 characters');
  });

  it('warns when DOCX extraction reaches its existing cap, without changing the extractor', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', `<w:document><w:p><w:r><w:t>${'a'.repeat(300_000)}OMITTED_TAIL</w:t></w:r></w:p></w:document>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const response = await post(new File([bytes as BlobPart], 'long.docx'));
    expect(response.status).toBe(200);
    expect((await response.json()).warning).toContain('characters of this file');
    expect(vi.mocked(generateJSON).mock.calls[0][0]).not.toContain('OMITTED_TAIL');
  });
});
