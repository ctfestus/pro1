'use client';

// Other items of the same kind, after a course, experience or path page's own content: the same
// category (or industry) first. Only what is offered publicly, read the way the landing page reads
// it: publicly_offered_content gates which ids may be shown, and the anon-readable views carry the
// card fields. So a signed-out visitor sees the row, and a private cohort's content never appears.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Briefcase, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { useToolIcons } from '@/lib/use-tool-icons';
import { itemCategory } from '@/lib/catalogue-path-items';

type Kind = 'course' | 'virtual_experience' | 'learning_path';
type Card = { id: string; title: string; slug: string | null; cover: string | null; category: string | null };

const SOURCE = {
  course: { table: 'courses', view: 'published_courses', columns: 'id, title, slug, cover_image, category', label: 'Course', Icon: BookOpen },
  virtual_experience: { table: 'virtual_experiences', view: 'published_virtual_experiences', columns: 'id, title, slug, cover_image, industry', label: 'Virtual experience', Icon: Briefcase },
  learning_path: { table: 'learning_paths', view: 'publicly_offered_learning_paths', columns: 'id, title, cover_image', label: 'Learning path', Icon: Layers },
} as const;

/** Read a few more than are shown, so the same-category ones can come first. */
const CANDIDATES = 24;
const SHOWN = 3;

async function loadCards(kind: Kind, currentId: string, category: string | null): Promise<Card[]> {
  const source = SOURCE[kind];
  let query = supabase.from(source.view).select(source.columns).neq('id', currentId).limit(CANDIDATES);
  // The path view is already gated. Courses and experiences are gated by id, on the query itself,
  // so private rows never take up the candidate budget.
  if (kind !== 'learning_path') {
    const { data: offered } = await supabase
      .from('publicly_offered_content').select('content_id').eq('content_table', source.table);
    const ids = (offered ?? []).map((row: any) => row.content_id).filter((id: string) => id !== currentId);
    if (!ids.length) return [];
    query = query.in('id', ids);
  }
  const { data } = await query;
  const cards: Card[] = (data ?? []).map((row: any) => ({
    id: row.id, title: row.title ?? 'Untitled', slug: row.slug ?? null, cover: row.cover_image ?? null, category: itemCategory(row),
  }));
  const same = (card: Card) => !!category && card.category?.toLowerCase() === category.toLowerCase();
  return [...cards.filter(same), ...cards.filter(card => !same(card))].slice(0, SHOWN);
}

export function MoreLikeThis({ kind, currentId, category = null, palette }: {
  kind: Kind;
  currentId: string;
  /** This item's category or industry, so items that share it come first. */
  category?: string | null;
  /** The page's own colours: each detail page has its own palette. */
  palette: { text: string; muted: string; tile: string };
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const toolIcon = useToolIcons();
  const source = SOURCE[kind];

  useEffect(() => {
    let cancelled = false;
    loadCards(kind, currentId, category).then(found => { if (!cancelled) setCards(found); }).catch(() => {});
    return () => { cancelled = true; };
  }, [kind, currentId, category]);

  if (!cards.length) return null;

  return (
    <section style={{ maxWidth: 1140, margin: '0 auto', padding: '0 16px 72px' }}>
      <h2 className="mb-4 text-lg font-bold" style={{ color: palette.text }}>
        {kind === 'learning_path' ? 'More learning paths' : 'More like this'}
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => {
          const cover = card.cover ? resolveCoverUrl(card.cover) : '';
          const logo = card.category ? toolIcon(card.category) : null;
          return (
            <Link key={card.id} href={`/${encodeURIComponent(card.slug || card.id)}?catalogueType=${kind}`}
              className="group block" style={{ textDecoration: 'none' }}>
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl" style={{ background: cover ? '#0b0b0d' : palette.tile }}>
                {cover
                  ? <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
                  : (
                    <div className="grid h-full w-full place-items-center transition-transform duration-500 group-hover:scale-[1.05]">
                      {logo ? <img src={logo} alt="" className="h-12 w-12 object-contain" /> : <source.Icon className="h-8 w-8" style={{ color: palette.muted }} />}
                    </div>
                  )}
                {card.category && (
                  <span className="absolute left-0 top-3 max-w-[70%] truncate px-2.5 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
                    {card.category}
                  </span>
                )}
              </div>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: palette.muted }}>{source.label}</p>
              <p className="mt-0.5 line-clamp-2 text-[16px] font-bold leading-snug" style={{ color: palette.text }}>{card.title}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
