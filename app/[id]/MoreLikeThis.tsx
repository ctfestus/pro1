'use client';

// Other items of the same kind, after a course, experience or path page's own content: the same
// category (or industry) first. Drawn from the landing page's own list, which holds only what is
// offered publicly, so a signed-out visitor sees the row and a private cohort's content never
// appears. The cards are the landing page's: cover, title, tags, level and tools.

import Link from 'next/link';
import { BookOpen, Briefcase, Stack as Layers } from '@phosphor-icons/react';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { CardMeta, FRAMED_CARD } from '@/components/CardMeta';

type Kind = 'course' | 'virtual_experience' | 'learning_path';

const SOURCE = {
  course: { type: 'course', Icon: BookOpen },
  virtual_experience: { type: 've', Icon: Briefcase },
  learning_path: { type: 'path', Icon: Layers },
} as const;

const SHOWN = 3;

export function MoreLikeThis({ kind, currentId, category = null, programmes, palette }: {
  kind: Kind;
  currentId: string;
  /** This item's category or industry, so items that share it come first. */
  category?: string | null;
  programmes: ProgrammeItem[];
  /** The page's own colours: each detail page has its own palette. */
  palette: { text: string; muted: string; tile: string; card: string; dark: boolean };
}) {
  const source = SOURCE[kind];
  const others = programmes.filter(item => item.type === source.type && item.id !== currentId);
  const same = (item: ProgrammeItem) => !!category && item.category?.toLowerCase() === category.toLowerCase();
  const cards = [...others.filter(same), ...others.filter(item => !same(item))].slice(0, SHOWN);
  if (!cards.length) return null;

  return (
    <section style={{ maxWidth: 1140, margin: '0 auto', padding: '0 16px 64px' }}>
      <h2 className="mb-4 text-[22px] leading-7 font-bold" style={{ color: palette.text }}>
        {kind === 'learning_path' ? 'More learning paths' : 'More like this'}
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => {
          const count = card.pathCourses?.length ?? 0;
          return (
            <Link key={card.id} href={`/${encodeURIComponent(card.slug || card.id)}?catalogueType=${kind}`}
              className={FRAMED_CARD} style={{ background: palette.card, textDecoration: 'none' }}>
              <div className="relative aspect-video w-full overflow-hidden" style={{ background: card.imageUrl ? '#0b0b0d' : palette.tile }}>
                {card.imageUrl
                  ? <img src={card.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
                  : <div className="grid h-full w-full place-items-center"><source.Icon className="h-8 w-8" style={{ color: palette.muted }} /></div>}
                {card.category && kind !== 'learning_path' && (
                  <span className="absolute left-0 top-3 max-w-[70%] truncate px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
                    {card.category}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col px-4 pt-3.5 pb-[18px]">
                <p className="line-clamp-2 min-h-[40px] text-[15px] font-bold leading-5" style={{ color: palette.text }}>{card.title}</p>
                <CardMeta tags={card.tags} level={kind === 'learning_path' ? undefined : card.level} tools={card.tools}
                  note={kind === 'learning_path' && count ? `${count} learning item${count === 1 ? '' : 's'}` : undefined}
                  isDark={palette.dark} text={palette.text} muted={palette.muted} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
