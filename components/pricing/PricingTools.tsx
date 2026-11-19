'use client';

// "The tools you will learn": the site's hero image beside a tile for each tool the published
// catalogue teaches. A tool gets a tile when it has a logo (the built-in set or one uploaded in
// Tool icons) and its name appears in a published course's or path's title or category. Each tile
// opens the list of those courses and paths, linked the way the home page links them.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useToolIconMap } from '@/lib/use-tool-icons';
import { resolveToolIcon } from '@/lib/tool-icons';
import { landingHref } from '@/lib/landing-href';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';

type Tile = { key: string; label: string; icon: string; items: ProgrammeItem[] };

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countLabel(items: ProgrammeItem[]) {
  const courses = items.filter(item => item.type === 'course').length;
  const paths = items.filter(item => item.type === 'path').length;
  return [
    courses ? `${courses} ${courses === 1 ? 'course' : 'courses'}` : '',
    paths ? `${paths} ${paths === 1 ? 'path' : 'paths'}` : '',
  ].filter(Boolean).join(', ');
}

export function PricingTools({ programmes, imageUrl, user, hFont }: {
  programmes: ProgrammeItem[];
  imageUrl?: string;
  user: unknown;
  hFont?: string;
}) {
  const icons = useToolIconMap();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const tiles = useMemo(() => {
    const items = programmes.filter(item => item.type === 'course' || item.type === 'path');
    const seenIcons = new Set<string>();
    const found: Tile[] = [];
    for (const key of Object.keys(icons)) {
      const icon = resolveToolIcon(icons, key);
      // Two names can share one logo ("azure" and "microsoft azure"); one tile is enough.
      if (!icon || seenIcons.has(icon)) continue;
      const pattern = new RegExp(`(^|[^a-z0-9])(${escapeRegExp(key).replace(/ /g, '\\s+')})(?![a-z0-9])`, 'i');
      const matches = items.map(item => ({ item, match: pattern.exec(`${item.title} ${item.category ?? ''}`) }))
        .filter(row => row.match);
      if (!matches.length) continue;
      seenIcons.add(icon);
      // Named as the catalogue writes it ("SQL", "Claude"), from the first title that mentions it.
      found.push({ key, label: matches[0].match![2], icon, items: matches.map(row => row.item) });
    }
    // Most taught first, so the strongest tools lead.
    return found.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  }, [programmes, icons]);

  if (!tiles.length) return null;
  const open = tiles.find(tile => tile.key === openKey) ?? null;

  return (
    <section className="mt-14 grid gap-4 lg:grid-cols-2" aria-labelledby="pricing-tools-heading">
      {imageUrl && (
        <div className="relative min-h-64 overflow-hidden rounded-[26px]" style={{ background: '#E8ECF1' }}>
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        </div>
      )}
      <div className={`rounded-[26px] bg-white p-6 sm:p-8 ${imageUrl ? '' : 'lg:col-span-2'}`} style={{ boxShadow: '0 14px 45px rgba(16,24,40,0.07)' }}>
        <h2 id="pricing-tools-heading" className="text-[22px] leading-7 font-black tracking-tight" style={{ color: '#101828', fontFamily: hFont }}>
          The tools you will learn
        </h2>
        <p className="mt-2 text-sm" style={{ color: '#667085' }}>Pick a tool to see the courses and paths that teach it.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map(tile => {
            const selected = tile.key === openKey;
            return (
              <button key={tile.key} type="button" aria-expanded={selected} aria-controls="pricing-tool-list"
                onClick={() => setOpenKey(selected ? null : tile.key)}
                className="flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center transition-colors"
                style={{ background: selected ? '#EEF1F5' : '#F7F9FB', boxShadow: selected ? 'inset 0 0 0 2px #101828' : 'none' }}>
                <img src={tile.icon} alt="" className="h-10 w-10 object-contain" loading="lazy" />
                <span className="text-sm font-black" style={{ color: '#101828' }}>{tile.label}</span>
                <span className="text-xs" style={{ color: '#667085' }}>{countLabel(tile.items)}</span>
              </button>
            );
          })}
        </div>
        {open && (
          <div id="pricing-tool-list" className="mt-4 rounded-2xl p-4" style={{ background: '#F7F9FB' }}>
            <p className="text-sm font-black" style={{ color: '#101828' }}>{open.label}</p>
            <ul className="mt-2 space-y-2">
              {open.items.map(item => (
                <li key={`${item.type}:${item.id}`}>
                  <Link href={landingHref(item, user)} className="text-sm font-bold underline-offset-4 hover:underline" style={{ color: '#101828' }}>
                    {item.title}
                  </Link>
                  <span className="ml-2 text-xs" style={{ color: '#667085' }}>{item.type === 'path' ? 'Learning path' : 'Course'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
