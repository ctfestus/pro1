import { describe, it, expect } from 'vitest';

import {
  ALLOWED_ACTIONS, INTERACTIVE_ACTIONS, BLOCK_KINDS, usableBlocks,
  buildTextPrompt, buildBlockPrompt, buildInstructionPrompt,
} from '@/lib/ai-assist-server';
import { INTERACTIVE_ACTIONS as MENU_ACTIONS } from '@/lib/ai-assist';

describe('ALLOWED_ACTIONS', () => {
  it('covers text actions and one make_<kind> per block kind', () => {
    expect(ALLOWED_ACTIONS.has('improve')).toBe(true);
    expect(ALLOWED_ACTIONS.has('make_auto')).toBe(true);
    for (const k of BLOCK_KINDS) expect(ALLOWED_ACTIONS.has(`make_${k}`)).toBe(true);
    expect(ALLOWED_ACTIONS.has('make_bogus')).toBe(false);
    expect(ALLOWED_ACTIONS.has('delete')).toBe(false);
  });

  it('accepts exactly the actions the editor menu offers', () => {
    // A menu entry the route rejects is a dead button; a kind with no menu entry is an
    // element the author can never ask for. Both are how the two lists drifted before.
    expect(MENU_ACTIONS.map((a) => a.action).sort()).toEqual([...INTERACTIVE_ACTIONS].sort());
  });
});

describe('usableBlocks', () => {
  it('accepts a block list that converts to lesson nodes', () => {
    const blocks = [{ type: 'tabs', parts: [{ label: 'One', body: 'Body' }] }];
    expect(usableBlocks(blocks)).toEqual(blocks);
  });

  it('rejects a list where nothing converts', () => {
    expect(usableBlocks([{ type: 'tabs', parts: [] }, { type: 'unknown' }])).toBeNull();
    expect(usableBlocks([])).toBeNull();
    expect(usableBlocks('nope')).toBeNull();
    expect(usableBlocks(undefined)).toBeNull();
  });
});

describe('prompts carry the JSON contract (so the schema-less OpenAI fallback still gets the shape)', () => {
  it('text prompt names the result field and says JSON', () => {
    const p = buildTextPrompt('improve', 'hello', '', '');
    expect(p).toContain('"result"');
    expect(p.toLowerCase()).toContain('json');
  });

  it('block prompts name the blocks field, the block library, and the requested kind', () => {
    for (const kind of BLOCK_KINDS) {
      const p = buildBlockPrompt(kind, 'x', '');
      expect(p).toContain('"blocks"');
      expect(p.toLowerCase()).toContain('json');
      expect(p).toContain('BLOCK LIBRARY');
    }
    expect(buildBlockPrompt('timeline', 'x', '')).toContain('timeline');
    expect(buildBlockPrompt('sql', 'x', '')).toContain('setupSql');
  });

  it('tells restructuring blocks to keep the author wording, and generative ones to write fresh', () => {
    // Without this the model returns a polished paraphrase, which lands directly under the
    // author's own paragraph (blocks insert after the selection) and reads as a duplicate.
    for (const kind of ['tabs', 'stepCards', 'callout', 'flipCards', 'accordion', 'timeline', 'table'] as const) {
      expect(buildBlockPrompt(kind, 'x', ''), kind).toContain("Keep the author's wording");
    }
    for (const kind of ['knowledgeCheck', 'sql', 'python'] as const) {
      expect(buildBlockPrompt(kind, 'x', ''), kind).toContain('does not already contain');
    }
  });

  it('tells the AI prompt block to copy the selection verbatim', () => {
    // The block wraps a prompt the author already wrote, so an "improved" prompt is a
    // different prompt, and the author cannot spot the edit without a side-by-side read.
    const p = buildBlockPrompt('promptBlock', 'x', '');
    expect(p).toContain('word for word');
    expect(p).not.toContain('does not already contain');
  });

  it('instruction prompt offers both answer modes and repeats the instruction', () => {
    const p = buildInstructionPrompt('x', 'turn this into three tabs', '');
    expect(p).toContain('turn this into three tabs');
    expect(p).toContain('"mode": "text"');
    expect(p).toContain('"mode": "blocks"');
    expect(p).toContain('BLOCK LIBRARY');
  });
});
