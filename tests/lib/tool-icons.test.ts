import { describe, it, expect } from 'vitest';
import { DEFAULT_TOOL_ICONS, normalizeToolName, resolveToolIcon, getToolIcon } from '@/lib/tool-icons';

// The icon lookup is an exact match on text a human typed -- a course category, a learner's
// skill -- so normalization is the whole contract: the writer and every reader must agree, or a
// saved logo silently fails to match the tool it was saved for.

describe('normalizeToolName', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalizeToolName('  Power BI ')).toBe('power bi');
    expect(normalizeToolName('EXCEL')).toBe('excel');
  });

  it('collapses inner whitespace, so a stray double space does not cost the logo', () => {
    expect(normalizeToolName('Power   BI')).toBe('power bi');
    expect(normalizeToolName('Perplexity\tAI')).toBe('perplexity ai');
  });

  it('returns an empty key for anything that is not usable text', () => {
    expect(normalizeToolName('   ')).toBe('');
    expect(normalizeToolName(undefined)).toBe('');
    expect(normalizeToolName(null)).toBe('');
    expect(normalizeToolName(42)).toBe('');
  });
});

describe('resolveToolIcon', () => {
  it('finds a tool however the name was capitalized or spaced', () => {
    const icons = { 'looker studio': 'https://res.cloudinary.com/c/image/upload/looker.png' };
    expect(resolveToolIcon(icons, 'Looker  Studio')).toContain('looker.png');
  });

  it('returns undefined for a tool with no logo, rather than a broken image', () => {
    expect(resolveToolIcon({}, 'Figma')).toBeUndefined();
    expect(resolveToolIcon({ excel: 'x' }, '  ')).toBeUndefined();
  });

  it('width-caps a Cloudinary reference so a 16px logo is not a full-size download', () => {
    const url = resolveToolIcon({ excel: 'https://res.cloudinary.com/c/image/upload/excel.png' }, 'excel');
    expect(url).toContain('w_128');
    expect(url).toContain('f_auto');
  });

  it('passes a non-Cloudinary URL through untouched, so the built-in defaults keep working', () => {
    const stored = 'https://abc.supabase.co/storage/v1/object/public/Tools%20icons/Excel.png';
    expect(resolveToolIcon({ excel: stored }, 'excel')).toBe(stored);
  });

  it('leaves an SVG alone, which is why SVG logos are stored as full URLs', () => {
    const svg = 'https://res.cloudinary.com/c/image/upload/aws.svg';
    expect(resolveToolIcon({ aws: svg }, 'aws')).toBe(svg);
  });
});

describe('getToolIcon', () => {
  it('still resolves the built-in set, which lesson prompt blocks depend on', () => {
    // ChatGPT and Claude label which assistant a prompt targets, so they must not require a
    // tenant to have uploaded anything.
    expect(getToolIcon('chatgpt')).toBeTruthy();
    expect(getToolIcon('Claude')).toBeTruthy();
    expect(Object.keys(DEFAULT_TOOL_ICONS)).toContain('power bi');
  });

  it('returns undefined for a tool nobody has an icon for', () => {
    expect(getToolIcon('n8n')).toBeUndefined();
  });
});
