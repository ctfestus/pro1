import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({ requireRole: vi.fn(), isAuthError: (value: any) => Boolean(value?.error) }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));
vi.mock('@/lib/ai', () => ({ generateJSON: vi.fn() }));

import { requireRole } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { generateJSON } from '@/lib/ai';
import { POST } from '@/app/api/application-forms/suggest-options/route';

const auth = vi.mocked(requireRole);
const redis = vi.mocked(getRedis);
const generate = vi.mocked(generateJSON);

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request('http://localhost/api/application-forms/suggest-options', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' }, body: JSON.stringify(body),
  }) as any) as unknown as Promise<Response>;
}

function redisStub(count = 1) {
  return { incr: vi.fn(async () => count), expire: vi.fn(async () => 1), del: vi.fn(async () => 1), ttl: vi.fn(async () => 3000) };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: 'instructor-1' }, role: 'instructor' } as any);
  redis.mockReturnValue(redisStub() as any);
  generate.mockResolvedValue({ options: ['Online', 'In person', 'Hybrid'] });
});

describe('POST /api/application-forms/suggest-options', () => {
  it('restricts generation to staff', async () => {
    auth.mockResolvedValue({ error: new Response('Forbidden', { status: 403 }) } as any);
    expect((await post({ label: 'Preferred learning format', questionType: 'single_choice' })).status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects invalid or oversized requests before using AI', async () => {
    expect((await post({ label: 'Name', questionType: 'single_choice' })).status).toBe(400);
    expect((await post({ label: 'What is your preference?', questionType: 'file' })).status).toBe(400);
    expect((await post({ label: 'a'.repeat(241), questionType: 'single_choice' })).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is missing or exhausted', async () => {
    redis.mockReturnValueOnce(null as any);
    expect((await post({ label: 'Preferred learning format', questionType: 'single_choice' })).status).toBe(503);
    redis.mockReturnValueOnce(redisStub(21) as any);
    expect((await post({ label: 'Preferred learning format', questionType: 'single_choice' })).status).toBe(429);
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns reviewed-ready choices and records the AI operation', async () => {
    generate.mockResolvedValue({ options: [' Online ', 'online', 'In\n person', 'Hybrid'] });
    const response = await post({ label: 'Preferred learning format', helpText: 'How would you like to join?', questionType: 'dropdown' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ options: ['Online', 'In person', 'Hybrid'] });
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('Preferred learning format'), expect.anything(), expect.objectContaining({ usageContext: { operation: 'application-option-suggestions', metadata: { questionType: 'dropdown' } } }));
  });

  it('does not pass unusable or failed model output to the builder', async () => {
    generate.mockResolvedValueOnce({ options: ['Only one'] });
    expect((await post({ label: 'Preferred learning format', questionType: 'single_choice' })).status).toBe(502);
    generate.mockRejectedValueOnce(new Error('Service down'));
    expect((await post({ label: 'Preferred learning format', questionType: 'single_choice' })).status).toBe(502);
  });
});
