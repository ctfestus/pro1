import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { blockInsertPos } from '@/lib/lesson-insert';

// The shapes that matter: a doc and a tab panel take any block; a deck takes only its own items,
// like a flip-card deck or an icon grid.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    deck: { group: 'block', content: 'item+' },
    item: { atom: true },
    tabs: { group: 'block', content: 'panel+' },
    panel: { content: 'block+' },
  },
});

const p = (t: string) => schema.node('paragraph', null, t ? [schema.text(t)] : []);
const deck = () => schema.node('deck', null, [schema.node('item'), schema.node('item')]);

// doc: paragraph "Hi" (0-4), deck (4-8: items at 5 and 6), paragraph "End" (8-13)
const doc = schema.node('doc', null, [p('Hi'), deck(), p('End')]);
const state = (selection: (d: typeof doc) => EditorState['selection']) =>
  EditorState.create({ doc, selection: selection(doc) });

describe('blockInsertPos', () => {
  it('leaves a caret in a paragraph to the normal insert', () => {
    expect(blockInsertPos(state((d) => TextSelection.create(d, 2)))).toBeNull();
  });

  it('puts the block after the deck when an item inside it is selected, so the deck is not split', () => {
    expect(blockInsertPos(state((d) => NodeSelection.create(d, 5)))).toBe(8);
  });

  it('puts the block after a selected block instead of replacing it', () => {
    expect(blockInsertPos(state((d) => NodeSelection.create(d, 4)))).toBe(8);
  });

  it('keeps a deck inside a tab panel and inserts after it within the panel', () => {
    // doc > tabs (0) > panel (1) > deck (2) > items at 3 and 4
    const nested = schema.node('doc', null, [schema.node('tabs', null, [schema.node('panel', null, [deck()])])]);
    const s = EditorState.create({ doc: nested, selection: NodeSelection.create(nested, 3) });
    expect(blockInsertPos(s)).toBe(6);
  });
});
