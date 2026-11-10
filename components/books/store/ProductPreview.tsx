'use client';

/**
 * The author's preview of a product's page (app/products/preview/[id]): the same layout buyers get
 * (ProductPageView), for the last saved version in any status, with a bar saying whether the page is
 * live and, if not, what keeps it off the store. Loaded with the author's session from
 * /api/books/[id]/page-preview, which only the owning instructor or an admin may read.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { signInHref } from '@/lib/auth-redirect';
import { ProductPageView } from '@/components/books/store/ProductPageView';
import type { StoreBook, StoreBookDetail } from '@/lib/books/store';

type State =
  | { phase: 'loading' }
  | { phase: 'signedOut' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; book: StoreBookDetail; blockers: string[] };

export function ProductPreview({ id, more, primaryColor, appName }: {
  id: string;
  more: StoreBook[];
  primaryColor: string;
  appName: string;
}) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { if (!cancelled) setState({ phase: 'signedOut' }); return; }
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(id)}/page-preview`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json?.book) setState({ phase: 'ready', book: json.book, blockers: Array.isArray(json.blockers) ? json.blockers : [] });
        else setState({
          phase: 'error',
          message: res.status === 403 ? 'Only the product\'s creator or an admin can preview this page.'
            : res.status === 404 ? 'This product does not exist.'
            : json?.error || 'Could not load the preview.',
        });
      } catch {
        if (!cancelled) setState({ phase: 'error', message: 'Could not load the preview.' });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (state.phase === 'loading') {
    return <div className="py-32 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#94a3b8' }} /></div>;
  }
  if (state.phase === 'signedOut' || state.phase === 'error') {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <p className="text-base font-semibold" style={{ color: '#0f172a' }}>
          {state.phase === 'signedOut' ? 'Sign in to preview this page.' : state.message}
        </p>
        {state.phase === 'signedOut' && (
          <Link href={signInHref(`/products/preview/${id}`)} className="mt-5 inline-flex px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: primaryColor, color: '#ffffff' }}>Sign in</Link>
        )}
      </div>
    );
  }

  const { book, blockers } = state;
  const live = blockers.length === 0;
  return (
    <>
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-5">
        <div className="rounded-2xl bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm"
          style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' }}>
          <p className="inline-flex items-center gap-2 font-semibold shrink-0" style={{ color: '#0f172a' }}>
            <Eye className="w-4 h-4" style={{ color: '#64748b' }} /> Preview
          </p>
          <div className="min-w-0 flex-1" style={{ color: '#475569' }}>
            {live ? (
              <p>This page is live. Buttons are off in the preview.</p>
            ) : (
              <>
                <p>Buyers cannot see this page yet. Buttons are off in the preview.</p>
                <ul className="mt-1 list-disc pl-5">
                  {blockers.map(b => <li key={b}>{b}</li>)}
                </ul>
              </>
            )}
          </div>
          {live && (
            <Link href={`/products/${encodeURIComponent(book.slug)}`} target="_blank" rel="noopener noreferrer"
              className="shrink-0 font-semibold underline underline-offset-2" style={{ color: '#0f172a' }}>Open the live page</Link>
          )}
        </div>
      </div>
      <ProductPageView book={book} more={more.filter(b => b.id !== book.id).slice(0, 4)} primaryColor={primaryColor}
        appName={appName} shareUrl="" preview />
    </>
  );
}
