import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentPageTitle, keepDocumentTitle } from '@/lib/document-title';

let onMutation: MutationCallback;
const observe = vi.fn();
const disconnect = vi.fn();

class MockMutationObserver {
  constructor(callback: MutationCallback) {
    onMutation = callback;
  }

  observe = observe;
  disconnect = disconnect;
}

describe('keepDocumentTitle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('restores the content name after streamed metadata changes the title', () => {
    vi.stubGlobal('document', { title: 'FestMan Learning', head: {} });
    vi.stubGlobal('MutationObserver', MockMutationObserver);
    const stop = keepDocumentTitle('Fintech Virtual Experience');

    expect(document.title).toBe('Fintech Virtual Experience');
    expect(observe).toHaveBeenCalledWith(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    document.title = 'Not Found';
    onMutation([], {} as MutationObserver);

    expect(document.title).toBe('Fintech Virtual Experience');
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('stops owning the title after the page unmounts', () => {
    vi.stubGlobal('document', { title: '', head: {} });
    vi.stubGlobal('MutationObserver', MockMutationObserver);
    const stop = keepDocumentTitle('Fintech Virtual Experience');
    stop();

    document.title = 'Student Dashboard';

    expect(document.title).toBe('Student Dashboard');
  });
});

describe('contentPageTitle', () => {
  it('uses a learning path preview title when there is no form', () => {
    expect(contentPageTitle(null, { title: 'Data Analyst Path' })).toBe('Data Analyst Path');
  });

  it('keeps form-backed content titles authoritative', () => {
    expect(contentPageTitle(
      { title: 'Row title', config: { title: 'Fintech Virtual Experience' } },
      { title: 'Data Analyst Path' },
    )).toBe('Fintech Virtual Experience');
  });
});
