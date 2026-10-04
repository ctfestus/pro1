import { describe, expect, it } from 'vitest';
import { safeVeUploadName, validateVeSubmissionFile, VE_SUBMISSION_MAX_BYTES } from '@/lib/ve-upload';

describe('virtual experience upload validation', () => {
  it('accepts supported work files', () => expect(validateVeSubmissionFile(new File(['ok'], 'analysis.xlsx'))).toBeNull());
  it('rejects unsupported and oversized files', () => {
    expect(validateVeSubmissionFile(new File(['x'], 'malware.exe'))).toMatch(/not supported/i);
    const oversized = new File([new Uint8Array(VE_SUBMISSION_MAX_BYTES + 1)], 'large.pdf');
    expect(validateVeSubmissionFile(oversized)).toMatch(/25 MB/i);
  });
  it('creates storage-safe names', () => expect(safeVeUploadName('My final report (v2).pdf')).toBe('My-final-report-v2-.pdf'));
});

describe('VE submission links', () => {
  const base = 'https://proj.supabase.co/storage/v1/object/public/form-assets/';
  // The exact link the standalone player saved for festmangroup@gmail.com (2026-10-04 report).
  const broken = `${base}submissions/fec1edab-6a50-4a51-aedd-553af1dfe368/festmangroup%2540gmail.com/req-lrm0q7yb-1791121716965-unnamed-24-.png`;

  it('repairs the double-escaped email folder so storage is asked for the real key', async () => {
    const { repairVeSubmissionUrl } = await import('@/lib/ve-upload');
    const fixed = repairVeSubmissionUrl(broken);
    expect(fixed).toBe(`${base}submissions/fec1edab-6a50-4a51-aedd-553af1dfe368/festmangroup%40gmail.com/req-lrm0q7yb-1791121716965-unnamed-24-.png`);
    // Storage decodes once: the key it looks up has the @ the file was stored under.
    expect(decodeURIComponent(fixed.slice(base.length))).toContain('/festmangroup@gmail.com/');
  });

  it('leaves working links and other URLs alone', async () => {
    const { repairVeSubmissionUrl } = await import('@/lib/ve-upload');
    const good = `${base}submissions/ve1/0f1e2d3c-user/req-1-1-report.pdf`;
    expect(repairVeSubmissionUrl(good)).toBe(good);
    expect(repairVeSubmissionUrl(repairVeSubmissionUrl(broken))).toBe(repairVeSubmissionUrl(broken));
    expect(repairVeSubmissionUrl('https://example.com/a%2540b')).toBe('https://example.com/a%2540b');
  });

  it('files new uploads under the account id, which needs no escaping', async () => {
    const { veSubmissionFolder } = await import('@/lib/ve-upload');
    const folder = veSubmissionFolder('ve1', '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
    expect(folder).toBe('submissions/ve1/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
    expect(encodeURI(folder)).toBe(folder);
  });
});
