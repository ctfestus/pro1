import { supabase } from '@/lib/supabase';
import type { BookFormat } from '@/lib/books/schema';

// Opens a book (or its free sample) in a new tab, for the owner or an admin checking what they
// uploaded. The server decides what the caller may see; this only picks the right route:
//   HTML -> the sandboxed /api/books/[id]/html page (never rendered on this app's origin)
//   PDF  -> the browser's own PDF viewer
//   EPUB -> a download, since browsers cannot show EPUB
//
// The tab is opened before the fetch so popup blockers treat it as part of the click.
export async function openBookPreview(bookId: string, format: BookFormat, variant: 'full' | 'sample'): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const id = encodeURIComponent(bookId);
    let url: string;
    if (format === 'html') {
      const res = await fetch(`/api/books/${id}/html-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ variant }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not open the preview.');
      url = d.url;
    } else {
      const qs = new URLSearchParams({ view: '1' });
      if (variant === 'sample') qs.set('variant', 'sample');
      const res = await fetch(`/api/books/${id}/file?${qs}`, { headers });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not open the preview.');
      url = d.url;
    }
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

// Downloads the full book for someone who owns it (or has it through their cohort). The file route
// re-checks access and signs a short-lived link with a download disposition, so following it in
// this tab saves the file without leaving the page.
export async function downloadBook(bookId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/file`, { headers });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.url) throw new Error(d.error || 'Could not download the product.');
  window.location.href = d.url;
}
