'use client';

// "The tools you will learn": the site's hero image beside two rows of tool tiles. A tile whose tool
// is named in a published course's or path's title or category opens the list of those items,
// linked the way the home page links them; the others are shown as tools on the programme.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { useToolIcons } from '@/lib/use-tool-icons';
import { landingHref } from '@/lib/landing-href';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';

// The data tools, then the AI tools. Logos come from Tool icons, so an uploaded one replaces the default.
const TOOLS = ['Excel', 'Power BI', 'SQL', 'ChatGPT', 'Claude', 'Perplexity AI'];

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function PricingTools({ programmes, imageUrl, user, hFont }: {
  programmes: ProgrammeItem[];
  imageUrl?: string;
  user: unknown;
  hFont?: string;
}) {
  const toolIcon = useToolIcons();
  const [openName, setOpenName] = useState<string | null>(null);

  const tiles = useMemo(() => {
    const items = programmes.filter(item => item.type === 'course' || item.type === 'path');
    return TOOLS.map(name => {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name).replace(/ /g, '\\s+')}(?![a-z0-9])`, 'i');
      return { name, icon: toolIcon(name), items: items.filter(item => pattern.test(`${item.title} ${item.category ?? ''}`)) };
    });
  }, [programmes, toolIcon]);

  const open = tiles.find(tile => tile.name === openName && tile.items.length) ?? null;

  return (
    <section className="mt-14 grid gap-4 lg:grid-cols-2" aria-labelledby="pricing-tools-heading">
      {imageUrl && (
        <div className="relative min-h-72 overflow-hidden rounded-[26px]" style={{ background: '#E8ECF1' }}>
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
            const selected = tile.name === openName;
            const body = <>
              {tile.icon
                ? <img src={tile.icon} alt="" className="h-14 w-14 object-contain" loading="lazy" />
                : <span className="h-14 w-14" />}
              <span className="text-base font-black" style={{ color: '#101828', fontFamily: hFont }}>{tile.name}</span>
            </>;
            const tileClass = 'flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl px-3 py-5 text-center';
            // A tool with nothing published to open yet is shown, not offered as a link.
            if (!tile.items.length) {
              // The empty line keeps every name on the same row as the tiles that say Learn more.
              return <div key={tile.name} className={tileClass} style={{ background: '#F7F9FB' }}>{body}<span aria-hidden="true" className="h-5" /></div>;
            }
            return (
              <button key={tile.name} type="button" aria-expanded={selected} aria-controls="pricing-tool-list"
                onClick={() => setOpenName(selected ? null : tile.name)}
                className={`${tileClass} transition-colors`}
                style={{ background: selected ? '#EEF1F5' : '#F7F9FB', boxShadow: selected ? 'inset 0 0 0 2px #101828' : 'none' }}>
                {body}
                <span className="inline-flex items-center gap-1 text-sm font-bold" style={{ color: '#475467' }}>
                  <Eye className="h-4 w-4" /> Learn more
                </span>
              </button>
            );
          })}
        </div>
        {open && (
          <div id="pricing-tool-list" className="mt-4 rounded-2xl p-4" style={{ background: '#F7F9FB' }}>
            <p className="text-sm font-black" style={{ color: '#101828' }}>{open.name}</p>
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
