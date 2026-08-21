import { describe, expect, it } from 'vitest';
import { buildBrandfetchLogoUrl, normalizeBrandDomain, parseBrandfetchResults, resolveBrandLogoUrl } from '@/lib/brandfetch';

describe('Brandfetch helpers', () => {
  it('normalizes domains and website URLs', () => {
    expect(normalizeBrandDomain('https://www.Microsoft.com/products')).toBe('microsoft.com');
    expect(normalizeBrandDomain('openai.com')).toBe('openai.com');
  });

  it('rejects invalid or non-web identifiers', () => {
    expect(normalizeBrandDomain('javascript:alert(1)')).toBeNull();
    expect(normalizeBrandDomain('not a domain')).toBeNull();
  });

  it('builds a typed, square Logo API URL', () => {
    expect(buildBrandfetchLogoUrl('https://www.openai.com', 'client id')).toBe(
      'https://cdn.brandfetch.io/domain/openai.com/w/128/h/128/fallback/lettermark/type/icon?c=client%20id',
    );
  });

  it('keeps valid brand metadata and drops malformed results', () => {
    expect(parseBrandfetchResults([
      { name: 'OpenAI', domain: 'openai.com', icon: 'https://example.test/icon', brandId: 'brand_1', claimed: true },
      { name: 'Bad', domain: 'not a domain' },
    ])).toEqual([{ name: 'OpenAI', domain: 'openai.com', icon: 'https://example.test/icon', brandId: 'brand_1', claimed: true }]);
  });

  it('drops a preview icon that is not a web URL', () => {
    // The icon is rendered straight into an <img src>, so the API's value is not taken on trust.
    expect(parseBrandfetchResults([
      { name: 'OpenAI', domain: 'openai.com', icon: 'javascript:alert(1)' },
    ])[0].icon).toBe('');
  });
});

describe('resolveBrandLogoUrl', () => {
  it('rebuilds the logo from the stored domain, so a rotated client id cannot break saved lessons', () => {
    expect(resolveBrandLogoUrl('https://cdn.brandfetch.io/domain/openai.com/w/128/h/128/fallback/lettermark/type/icon?c=old', 'openai.com', 'new')).toBe(
      'https://cdn.brandfetch.io/domain/openai.com/w/128/h/128/fallback/lettermark/type/icon?c=new',
    );
  });

  it('keeps a library upload untouched -- it has no brand domain', () => {
    const uploaded = 'https://res.cloudinary.com/demo/image/upload/logo.png';
    expect(resolveBrandLogoUrl(uploaded, '', 'client')).toBe(uploaded);
  });

  it('falls back to the saved URL when the tenant has no client id configured', () => {
    const saved = 'https://cdn.brandfetch.io/domain/openai.com/w/128/h/128/fallback/lettermark/type/icon?c=old';
    expect(resolveBrandLogoUrl(saved, 'openai.com', '')).toBe(saved);
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(resolveBrandLogoUrl('', '', 'client')).toBe('');
  });
});
