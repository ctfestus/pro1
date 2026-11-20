'use client';

/**
 * The landing page's learning paths: one card per path. A cover on top, a coloured body with the
 * title and how many learning items the path holds, and a View path button tucked into a notch at the
 * bottom right. Hovering or focusing the card slides the body up over the cover to show the
 * description; on a touch screen, which has no hover, the description shows from the start.
 *
 * Every card takes one colour, set under Brand & Style in Site settings: the button in that colour
 * and the body in a pale tint of it. The whole card is one link to the path's public page.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { landingHref } from '@/lib/landing-href';
import { toPlainText } from '@/lib/plain-text';
import { M3 } from '@/components/landing/type';

// The notch is the section's own ground showing through: the panel stops above it, the foot stops
// to its left, and the fillet rounds the inside corner where the two meet.
const CARD_CSS = `
.path-card { --r: 24px; --nw: 164px; --nh: 68px; position: relative; display: block; height: 440px; color: #1C1D1F; text-decoration: none; outline: none; }
.path-card .pc-panel { position: absolute; inset: 0 0 var(--nh) 0; border-radius: var(--r) var(--r) var(--r) 0; background: var(--tint); overflow: hidden; }
.path-card .pc-foot { position: absolute; left: 0; bottom: 0; width: calc(100% - var(--nw)); height: calc(var(--nh) + 1px); background: var(--tint); border-radius: 0 0 var(--r) var(--r); }
.path-card .pc-fillet { position: absolute; right: calc(var(--nw) - var(--r)); bottom: calc(var(--nh) - var(--r)); width: var(--r); height: var(--r);
  background: radial-gradient(circle at 100% 100%, transparent calc(var(--r) - 0.5px), var(--tint) var(--r)); }
.path-card .pc-cover { position: absolute; inset: 0 0 auto 0; height: 44%; background: #0b0b0d center / cover no-repeat; transition: opacity 0.45s ease; }
.path-card .pc-layer { position: absolute; left: 0; right: 0; top: 44%; height: 100%; padding: 24px 24px 0; background: var(--tint); transition: transform 0.45s cubic-bezier(0.2, 0, 0, 1); }
.path-card .pc-desc { margin-top: 16px; opacity: 0; transform: translateY(8px); transition: opacity 0.3s ease 0.1s, transform 0.3s ease 0.1s;
  display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.path-card:hover .pc-layer, .path-card:focus-visible .pc-layer { transform: translateY(-44%); }
/* Faded as the body covers it, so no edge of the photo shows at the rounded corners. */
.path-card:hover .pc-cover, .path-card:focus-visible .pc-cover { opacity: 0; }
.path-card:hover .pc-desc, .path-card:focus-visible .pc-desc { opacity: 1; transform: none; }
.path-card .pc-btn { position: absolute; right: 0; bottom: 0; height: 52px; display: inline-flex; align-items: center; gap: 10px; padding: 0 24px;
  border-radius: 999px; background: var(--deep); color: #ffffff; white-space: nowrap; }
.path-card .pc-btn svg { transition: transform 0.25s; }
.path-card:hover .pc-btn svg { transform: translateX(3px); }
.path-card:focus-visible .pc-btn { box-shadow: 0 0 0 3px #ffffff, 0 0 0 6px var(--deep); }
@media (hover: none) {
  .path-card .pc-layer { transform: none; }
  .path-card .pc-cover { opacity: 1; }
  .path-card .pc-desc { opacity: 1; transform: none; -webkit-line-clamp: 2; }
}
@media (prefers-reduced-motion: reduce) {
  .path-card .pc-layer, .path-card .pc-desc, .path-card .pc-cover, .path-card .pc-btn svg { transition: none; }
}
`;

export function PathCards({ paths, color, user, hFont, bFont }: {
  paths: ProgrammeItem[];
  /** A #rrggbb colour. */
  color: string;
  user: unknown;
  hFont?: string;
  bFont?: string;
}) {
  return (
    <>
      <style>{CARD_CSS}</style>
      {/* One and a bit cards on a phone, scrolling sideways; two across on a tablet, three on a
          wide screen. */}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-6 sm:overflow-visible"
        style={{ scrollbarWidth: 'none' }}>
        {paths.map(path => {
          const count = path.pathCourses?.length ?? 0;
          const desc = toPlainText(path.description);
          return (
            <Link key={path.id} href={landingHref(path, user)}
              className="path-card flex-[0_0_82%] snap-start sm:flex-auto"
              style={{ ['--tint' as string]: `color-mix(in srgb, ${color} 16%, #ffffff)`, ['--deep' as string]: color }}>
              <div className="pc-panel">
                <div className="pc-cover" style={{ backgroundImage: path.imageUrl ? `url(${path.imageUrl})` : undefined }} />
                <div className="pc-layer">
                  <p className="line-clamp-3" style={{ ...M3.headlineSmall, fontWeight: 700, fontFamily: hFont }}>{path.title}</p>
                  {count > 0 && (
                    <p className="mt-2" style={{ ...M3.bodyMedium, color: '#4b5160', fontFamily: bFont }}>
                      {count} learning item{count === 1 ? '' : 's'}
                    </p>
                  )}
                  {desc && <p className="pc-desc" style={{ ...M3.bodyLarge, color: '#4b5160', fontFamily: bFont }}>{desc}</p>}
                </div>
              </div>
              <div className="pc-foot" />
              <div className="pc-fillet" />
              <span className="pc-btn" style={{ ...M3.labelLarge, fontWeight: 700, fontFamily: hFont }}>
                View path
                <ArrowRight className="w-[18px] h-[18px]" aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
