// Opt-in, paid API checks using synthetic content only. Never log prompts or answers.
// Run with RUN_LIVE_AI=gemini (or anthropic), loading local credentials separately.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { generateJSON, generateText } from '@/lib/ai';
import { buildBlockPrompt, buildInstructionPrompt, buildTextPrompt, TEXT_SCHEMA, usableBlocks } from '@/lib/ai-assist-server';
import { buildTutorPrompt, MAX_OUTPUT_TOKENS, TUTOR_SYSTEM_INSTRUCTION } from '@/lib/lesson-tutor';

vi.mock('@/lib/api-auth', () => ({ requireUser: vi.fn(async () => ({ user: { id: 'synthetic-test' }, role: 'student' })), isAuthError: () => false }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));
vi.mock('@/lib/ai-feature-gate', () => ({ chargeAiFeature: vi.fn(async () => ({})), refundAiFeature: vi.fn() }));
import { POST as documentReview } from '@/app/api/document-review/route';

const selected = process.env.RUN_LIVE_AI;
const reportText = 'A regional retailer should pilot online ordering at two stores before expanding. Survey 100 customers, measure weekly order accuracy and delivery time, and cap the pilot budget at GHS 20,000. Review the results after eight weeks. Main risks are unreliable delivery and low adoption. Train store staff and use customer feedback to address these risks.';

describe.skipIf(!['gemini', 'anthropic'].includes(selected ?? ''))('live provider smoke checks (synthetic, not grading comparisons)', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', selected!);
    vi.stubEnv('AI_PROVIDER_AI_ASSIST', selected!);
    vi.stubEnv('AI_PROVIDER_DOCUMENT_REVIEW', selected!);
    vi.stubEnv('AI_PROVIDER_TUTOR', selected!);
    vi.stubEnv('AI_FALLBACK_PROVIDERS', '');
    if (!process.env[`${selected!.toUpperCase()}_API_KEY`]) throw new Error('Missing local provider credential');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('builds content-bearing editor blocks', async () => {
    const result = await generateJSON(buildBlockPrompt('knowledgeCheck', 'A primary key uniquely identifies a row. A foreign key refers to a key in another table.', ''), undefined,
      { feature: 'ai-assist', effort: 'low', retries: 0, noFallback: true });
    expect(usableBlocks(result.blocks)).not.toBeNull();
    expect(result.blocks.some((block: { type: string }) => block.type === 'knowledgeCheck')).toBe(true);
  }, 180_000);

  it('accepts schema-less instructions with nested, usable content', async () => {
    const result = await generateJSON(buildInstructionPrompt('A primary key identifies a row. A foreign key links tables.', 'Create two tabs, one for each key, with a note callout inside each tab.', ''), undefined,
      { feature: 'ai-assist', effort: 'low', retries: 0, noFallback: true });
    expect(result.mode).toBe('blocks');
    expect(usableBlocks(result.blocks)).not.toBeNull();
    expect(result.blocks.some((block: { type: string }) => block.type === 'tabs')).toBe(true);
  }, 180_000);

  it('accepts the text variant of schema-less instructions', async () => {
    const result = await generateJSON(buildInstructionPrompt('A primary key is a unique identifier for a row.', 'Make this sentence clearer without adding blocks.', ''), undefined,
      { feature: 'ai-assist', effort: 'low', retries: 0, noFallback: true });
    expect(result.mode).toBe('text');
    expect(result.result.trim()).not.toBe('');
  }, 180_000);

  it('keeps structured plain-text rewrites', async () => {
    const result = await generateJSON(buildTextPrompt('shorten', 'A primary key is a unique identifier for a row in a database table.', '', ''), TEXT_SCHEMA,
      { feature: 'ai-assist', effort: 'low', retries: 0, noFallback: true });
    expect(result.result.trim()).not.toBe('');
  }, 180_000);

  it.each(['txt', 'docx'])('reviews extracted %s content through the route', async (extension) => {
    let bytes: BlobPart = reportText;
    if (extension === 'docx') {
      const zip = new JSZip();
      zip.file('word/document.xml', `<w:document><w:p><w:r><w:t>${reportText}</w:t></w:r></w:p></w:document>`);
      bytes = await zip.generateAsync({ type: 'uint8array' }) as BlobPart;
    }
    const form = new FormData();
    form.append('file', new File([bytes], `synthetic-report.${extension}`));
    const response = await documentReview(new Request('http://localhost/api/document-review', { method: 'POST', body: form }) as any);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.executiveSummary.trim()).not.toBe('');
    expect(result.categories.length).toBeGreaterThan(0);
  }, 180_000);

  it('answers a short tutor question within the new output budget', async () => {
    if (!process.env[`${selected!.toUpperCase()}_TUTOR_API_KEY`]) throw new Error('Missing dedicated local tutor credential');
    for (const outputLimit of selected === 'gemini' ? [900, MAX_OUTPUT_TOKENS] : [MAX_OUTPUT_TOKENS]) {
      const reply = await generateText(buildTutorPrompt({ courseTitle: 'Database basics', lessonTitle: 'Relational keys', lessonText: 'Primary keys uniquely identify rows. Foreign keys link rows in different tables.' }, 'What is a primary key?', []),
        { feature: 'tutor', effort: 'low', retries: 0, noFallback: true, maxOutputTokens: outputLimit, systemInstruction: TUTOR_SYSTEM_INSTRUCTION });
      const words = reply.trim().split(/\s+/).length;
      console.info('[live-ai-check]', JSON.stringify({ provider: selected, case: 'short-tutor', words, outputLimit }));
      expect(words).toBeGreaterThan(0);
      expect(words).toBeLessThan(250);
    }
  }, 180_000);
});
