/**
 * Keep an access-approved client title authoritative while its page is mounted.
 *
 * App Router metadata is streamed for normal browsers, so a server title can arrive after a
 * client has loaded protected content and set its real title. Observing the head closes that race
 * without exposing protected metadata to the anonymous server lookup.
 */
export function keepDocumentTitle(name: string): () => void {
  const syncTitle = () => {
    if (document.title !== name) document.title = name;
  };

  syncTitle();
  const observer = new MutationObserver(syncTitle);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

type ContentTitleSource = {
  title?: string | null;
  config?: { title?: string | null } | null;
} | null | undefined;

/** Resolve the title for both form-backed content and the separate learning-path preview. */
export function contentPageTitle(form: ContentTitleSource, pathPreview: ContentTitleSource): string {
  return form?.config?.title || form?.title || pathPreview?.title || '';
}
