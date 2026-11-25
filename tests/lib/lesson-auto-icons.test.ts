import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { iconForText, suggestLessonIcons } from '@/lib/lesson-auto-icons';

// The node names and attrs the lesson editor uses, without its React views.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    stepCards: { group: 'block', content: 'stepCard+' },
    stepCard: { content: 'paragraph+', attrs: { title: { default: '' }, icon: { default: '' } } },
    tabs: { group: 'block', content: 'tabPanel+' },
    tabPanel: { content: 'paragraph+', attrs: { label: { default: '' }, icon: { default: '' } } },
    deck: { group: 'block', content: 'flipCard+' },
    flipCard: { atom: true, attrs: { front: { default: '' }, icon: { default: 'none' }, iconUrl: { default: '' } } },
  },
});
const p = (t = 'x') => schema.node('paragraph', null, [schema.text(t)]);
const step = (title: string, icon = '') => schema.node('stepCard', { title, icon }, [p()]);
const iconsOf = (doc: ReturnType<typeof schema.node>) => {
  const changes = new Map(suggestLessonIcons(doc).map((c) => [c.pos, c.icon]));
  const out: string[] = [];
  doc.descendants((node, pos) => { if (node.attrs && 'icon' in node.attrs) out.push(changes.get(pos) ?? `kept:${node.attrs.icon}`); return true; });
  return out;
};

describe('iconForText', () => {
  it('prefers a tool logo when the text names a built-in tool', () => {
    expect(iconForText('Open the file in Excel')).toBe('tool:excel');
    expect(iconForText('Publish to Power BI')).toBe('tool:power bi');
  });
  it('otherwise picks an icon from the words, or nothing', () => {
    expect(iconForText('Remove duplicate rows')).not.toBe('');
    expect(iconForText('Xyz qwv')).toBe('');
  });
});

describe('suggestLessonIcons', () => {
  it('fills every empty item of a block that has a match, with a plain icon for the rest', () => {
    const doc = schema.node('doc', null, [schema.node('stepCards', null, [step('Filter the rows'), step('Xyz qwv')])]);
    expect(iconsOf(doc)).toEqual(['filter', 'checklist']);
  });

  it('leaves a block alone when nothing in it matches', () => {
    const doc = schema.node('doc', null, [schema.node('stepCards', null, [step('Xyz'), step('Qwv')])]);
    expect(suggestLessonIcons(doc)).toEqual([]);
  });

  it('never changes an icon the author chose, and completes a block that has some', () => {
    const doc = schema.node('doc', null, [schema.node('stepCards', null, [step('Filter the rows', 'star'), step('Xyz')])]);
    expect(iconsOf(doc)).toEqual(['kept:star', 'checklist']);
  });

  it('uses tab labels, and skips a flip card that shows its own image', () => {
    const doc = schema.node('doc', null, [
      schema.node('tabs', null, [schema.node('tabPanel', { label: 'Excel' }, [p()]), schema.node('tabPanel', { label: 'SQL' }, [p()])]),
      schema.node('deck', null, [schema.node('flipCard', { front: 'Churn rate', iconUrl: 'https://x/y.png' }), schema.node('flipCard', { front: 'Customer churn' })]),
    ]);
    expect(iconsOf(doc)).toEqual(['tool:excel', 'tool:sql', 'kept:none', 'decline']);
  });
});
