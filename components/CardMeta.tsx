'use client';

/**
 * The details under a catalogue card's title, shared by the landing page and the student Explore
 * page so the two draw them the same: the tags (as many as fit, then "+N"), and a line with the
 * level's bars on the left and the tools' logos on the right. Anything an item does not have is
 * simply left out.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LevelBars } from '@/components/CataloguePreview';
import { useToolIcons } from '@/lib/use-tool-icons';

/** The white card these details sit in: its corners, soft shadow and lift on hover. */
export const FRAMED_CARD =
  'flex flex-col h-full group cursor-pointer rounded-xl overflow-hidden transition-[transform,box-shadow] duration-300 hover:-translate-y-1 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)] hover:shadow-[0_2px_4px_rgba(16,24,40,0.06),0_18px_36px_-14px_rgba(16,24,40,0.28)]';

/** The small grey labels (tags and the "+N" after them). */
function TagChip({ children, isDark }: { children: ReactNode; isDark?: boolean }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center h-[22px] px-2 rounded-md text-[12px] font-medium whitespace-nowrap"
      style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#F1F3F5', color: isDark ? 'rgba(255,255,255,0.75)' : '#4b5160' }}>
      {children}
    </span>
  );
}

/**
 * As many tags as fit on one line; when some do not, "+N" counts them. Measured from the card's
 * own width, so a phone shows fewer than a desktop, and measured again when the card resizes.
 */
function FitTags({ tags, isDark }: { tags: string[]; isDark?: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(tags.length);
  useEffect(() => {
    const row = rowRef.current, measure = measureRef.current;
    if (!row || !measure) return;
    const GAP = 6; // the space between chips
    const fit = () => {
      // The hidden row holds every tag, then "+1", "+2" ... "+(tags - 1)": the room a "+N" chip
      // needs is read from the very chip that would show, not guessed.
      const chips = [...measure.children].map(el => (el as HTMLElement).offsetWidth);
      const widths = chips.slice(0, tags.length);
      const more = (hidden: number) => chips[tags.length + hidden - 1] ?? 0;
      const span = (n: number) => widths.slice(0, n).reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, n - 1);
      if (span(widths.length) <= row.clientWidth) { setShown(widths.length); return; }
      let n = widths.length - 1;
      while (n > 1 && span(n) + GAP + more(widths.length - n) > row.clientWidth) n--;
      setShown(n);
    };
    // The card resizing changes the room; the hidden row resizing (the web font arriving after the
    // first measure) changes the tags' own widths. Either one re-fits.
    const obs = new ResizeObserver(fit);
    obs.observe(row);
    obs.observe(measure);
    return () => obs.disconnect();
  }, [tags]);
  return (
    <div ref={rowRef} className="relative flex gap-1.5 overflow-hidden">
      {tags.slice(0, shown).map(tag => <TagChip key={tag} isDark={isDark}>{tag}</TagChip>)}
      {shown < tags.length && <TagChip isDark={isDark}>+{tags.length - shown}</TagChip>}
      {/* Every tag and every possible "+N", invisible, so their widths can be read whatever is showing. */}
      <div ref={measureRef} aria-hidden="true" className="absolute left-0 top-0 invisible flex gap-1.5">
        {tags.map(tag => <TagChip key={tag} isDark={isDark}>{tag}</TagChip>)}
        {tags.slice(1).map((_, i) => <TagChip key={`+${i + 1}`} isDark={isDark}>+{i + 1}</TagChip>)}
      </div>
    </div>
  );
}

export function CardMeta({ tags = [], level, tools = [], isDark, text, muted }: {
  tags?: string[];
  /** Beginner, Intermediate or Advanced. */
  level?: string;
  tools?: string[];
  isDark?: boolean;
  text: string;
  muted: string;
}) {
  const toolIcon = useToolIcons();
  if (!tags.length && !level && !tools.length) return null;
  return (
    <div className="mt-auto pt-2.5 flex flex-col gap-2">
      {tags.length > 0 && <FitTags tags={tags} isDark={isDark} />}
      {(level || tools.length > 0) && (
        <div className="flex items-center justify-between gap-2 min-h-[22px]">
          {level ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] leading-[18px]" style={{ color: muted }}>
              <LevelBars level={level} color={text} track={isDark ? 'rgba(255,255,255,0.25)' : '#D5DAE1'} />
              {level}
            </span>
          ) : <span />}
          {tools.length > 0 && (
            <span className="flex flex-shrink-0 items-center gap-1.5">
              {/* The stored logo, no frame (some logos carry the tool's name themselves, so the width
                  follows the image); a tool the library has no logo for shows its name. */}
              {tools.map(tool => toolIcon(tool)
                ? <img key={tool} src={toolIcon(tool)!} alt={tool} title={tool} className="h-4 w-auto max-w-[60px] object-contain" />
                : <span key={tool} className="text-[12px] font-semibold" style={{ color: muted }}>{tool}</span>)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
