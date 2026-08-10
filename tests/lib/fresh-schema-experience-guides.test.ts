import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fresh schema experience guides', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');

  it('contains the guide table and both virtual experience guide columns', () => {
    expect(schema).toContain('CREATE TABLE public.experience_guides');
    expect(schema).toMatch(/guide_id\s+uuid\s+REFERENCES public\.experience_guides/);
    expect(schema).toMatch(/guide_snapshot\s+jsonb/);
  });

  it('requires both staff role and ownership in guide RLS', () => {
    expect(schema).toContain('ON public.experience_guides FOR SELECT TO authenticated');
    expect(schema).toContain('(SELECT public.is_instructor_or_admin()) AND owner_id = (SELECT auth.uid())');
  });
});
