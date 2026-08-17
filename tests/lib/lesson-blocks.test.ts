import { describe, it, expect } from 'vitest';

// The AI block contract shared by the course generators and the inline "Ask AI" assistant.
// The load-bearing test is the first one: a block type the AI is told about but that
// buildLessonNodes cannot convert would be silently dropped from every generated lesson.

import { buildLessonNodes, buildLessonDoc, AI_BLOCK_TYPES, type AiBlock } from '@/lib/lesson-blocks';
import { LESSON_BLOCK_GUIDE, lessonBlockSchema } from '@/lib/lesson-blocks-ai';

// One minimal-but-valid block per advertised type, and the lesson node it must become.
const SAMPLES: Record<string, { block: AiBlock; node: string }> = {
  paragraph:      { block: { type: 'paragraph', text: 'Hello' }, node: 'paragraph' },
  heading:        { block: { type: 'heading', level: 4, text: 'Title' }, node: 'heading' },
  bulletList:     { block: { type: 'bulletList', items: ['a', 'b'] }, node: 'bulletList' },
  orderedList:    { block: { type: 'orderedList', items: ['a', 'b'] }, node: 'orderedList' },
  blockquote:     { block: { type: 'blockquote', text: 'Quoted' }, node: 'blockquote' },
  table:          { block: { type: 'table', rows: [{ cells: ['A', 'B'] }, { cells: ['1', '2'] }] }, node: 'table' },
  callout:        { block: { type: 'callout', variant: 'tip', title: 'T', text: 'B' }, node: 'callout' },
  knowledgeCheck: { block: { type: 'knowledgeCheck', question: 'Q', options: ['a', 'b'], correctIndex: 1 }, node: 'knowledgeCheck' },
  runnableCode:   { block: { type: 'runnableCode', language: 'sql', code: 'SELECT 1' }, node: 'runnableCode' },
  promptBlock:    { block: { type: 'promptBlock', prompt: 'Summarize this' }, node: 'promptBlock' },
  flipCards:      { block: { type: 'flipCards', parts: [{ front: 'F', back: 'B' }] }, node: 'flipCardDeck' },
  accordion:      { block: { type: 'accordion', parts: [{ title: 'S', body: 'B' }] }, node: 'accordion' },
  tabs:           { block: { type: 'tabs', parts: [{ label: 'One', body: 'B' }] }, node: 'tabs' },
  carousel:       { block: { type: 'carousel', parts: [{ title: 'S', body: 'B' }] }, node: 'carousel' },
  timeline:       { block: { type: 'timeline', parts: [{ date: '2020', title: 'T', body: 'B' }] }, node: 'timeline' },
  stepCards:      { block: { type: 'stepCards', parts: [{ title: 'Step 1', body: 'B' }] }, node: 'stepCards' },
  guidedSteps:    { block: { type: 'guidedSteps', parts: [{ title: 'Step 1', body: 'B' }] }, node: 'stepper' },
};

describe('every advertised block type is buildable', () => {
  it('has a sample and a converter case for each entry in AI_BLOCK_TYPES', () => {
    for (const type of AI_BLOCK_TYPES) {
      const sample = SAMPLES[type];
      expect(sample, `no sample for ${type}`).toBeTruthy();
      const nodes = buildLessonNodes([sample.block]);
      expect(nodes.length, `${type} produced no node`).toBe(1);
      expect(nodes[0].type).toBe(sample.node);
    }
  });

  it('names every type in the prompt guide, so the model knows it exists', () => {
    for (const type of AI_BLOCK_TYPES) {
      expect(LESSON_BLOCK_GUIDE, `guide does not mention ${type}`).toContain(`"${type}"`);
    }
  });
});

describe('containers', () => {
  it('gives a section its nested children instead of a paragraph body', () => {
    const [tabs] = buildLessonNodes([{
      type: 'tabs',
      parts: [{
        label: 'Practice',
        children: [{ type: 'knowledgeCheck', question: 'Q', options: ['a', 'b'], correctIndex: 0 }],
      }],
    }]);
    const panel = tabs.content?.[0];
    expect(panel?.type).toBe('tabPanel');
    expect(panel?.attrs?.label).toBe('Practice');
    expect(panel?.content?.[0]?.type).toBe('knowledgeCheck');
  });

  it('falls back to a paragraph body, and always emits one so the node is valid', () => {
    const [accordion] = buildLessonNodes([{ type: 'accordion', parts: [{ title: 'S' }] }]);
    expect(accordion.content?.[0]?.content).toEqual([{ type: 'paragraph' }]);
  });

  it('nests blocks inside a callout via children', () => {
    const [callout] = buildLessonNodes([{
      type: 'callout',
      title: 'Watch out',
      children: [{ type: 'bulletList', items: ['one'] }],
    }]);
    expect(callout.content?.[0]?.type).toBe('bulletList');
  });

  it('stops recursing on a self-referencing tree instead of hanging', () => {
    const deep: AiBlock = { type: 'tabs', parts: [{ label: 'a' }] };
    let cursor = deep;
    for (let i = 0; i < 12; i++) {
      const next: AiBlock = { type: 'tabs', parts: [{ label: `t${i}` }] };
      cursor.parts![0].children = [next];
      cursor = next;
    }
    expect(() => buildLessonNodes([deep])).not.toThrow();
  });
});

describe('validation', () => {
  it('drops blocks with nothing usable in them', () => {
    expect(buildLessonNodes([
      { type: 'paragraph', text: '' },
      { type: 'tabs', parts: [] },
      { type: 'runnableCode', language: 'sql', code: '' },
      { type: 'knowledgeCheck', question: 'Q', options: ['only one'] },
      { type: 'somethingNew' },
      null,
      'not a block',
    ])).toEqual([]);
  });

  it('falls back to safe values for out-of-range attrs', () => {
    const [callout] = buildLessonNodes([{ type: 'callout', variant: 'purple', title: 'T' }]);
    expect(callout.attrs?.variant).toBe('note');
    const [check] = buildLessonNodes([{ type: 'knowledgeCheck', question: 'Q', options: ['a', 'b'], correctIndex: 9 }]);
    expect(check.attrs?.correctIndex).toBe(0);
  });

  it('accepts the names a model reaches for instead of the canonical type', () => {
    expect(buildLessonNodes([{ type: 'flashcards', parts: [{ front: 'F', back: 'B' }] }])[0].type).toBe('flipCardDeck');
    expect(buildLessonNodes([{ type: 'stepper', parts: [{ title: 'S' }] }])[0].type).toBe('stepper');
    expect(buildLessonNodes([{ type: 'quiz', question: 'Q', options: ['a', 'b'] }])[0].type).toBe('knowledgeCheck');
  });

  it('builds a doc with an empty paragraph rather than an invalid empty doc', () => {
    expect(buildLessonDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('lessonBlockSchema (the generators cannot skip a response schema)', () => {
  const branches = (lessonBlockSchema() as any).anyOf as any[];
  const byType: Record<string, any> = Object.fromEntries(branches.map((b) => [b.properties.type.enum[0], b]));

  it('has one branch per advertised block type', () => {
    expect(Object.keys(byType).sort()).toEqual([...AI_BLOCK_TYPES].sort());
  });

  it('requires the field each block carries its content in', () => {
    // Left optional, the model answers with a plausible field from another block type and
    // omits the real one -- a promptBlock with a title and no prompt, tabs with no bodies.
    for (const [type, branch] of Object.entries(byType)) {
      expect(branch.required.filter((r: string) => r !== 'type').length, `${type} requires nothing`).toBeGreaterThan(0);
      const parts = branch.properties.parts;
      if (parts) expect(parts.items.required.length, `${type} sections require nothing`).toBeGreaterThan(0);
    }
    expect(byType.promptBlock.required).toContain('prompt');
    expect(byType.knowledgeCheck.required).toContain('options');
    expect(byType.tabs.properties.parts.items.required).toContain('body');
    expect(byType.flipCards.properties.parts.items.required).toEqual(['front', 'back']);
  });

  it('builds a valid lesson node from each branch shape', () => {
    for (const type of Object.keys(byType)) {
      expect(buildLessonNodes([SAMPLES[type].block]).length, `${type} sample does not convert`).toBe(1);
    }
  });
});
