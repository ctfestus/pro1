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

/** The small grey labels (tags and the "+N" after them). On a tinted card they sit on soft white. */
function TagChip({ children, isDark, onTint }: { children: ReactNode; isDark?: boolean; onTint?: boolean }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center h-[22px] px-2 rounded-md text-[12px] font-medium whitespace-nowrap"
      style={{
        background: onTint ? 'rgba(255,255,255,0.65)' : isDark ? 'rgba(255,255,255,0.08)' : '#F1F3F5',
        color: isDark && !onTint ? 'rgba(255,255,255,0.75)' : '#4b5160',
      }}>
      {children}
    </span>
  );
}

/**
 * How many of the tags fit in `lines` rows of `room` px, with a "+N" chip after them when some do
 * not. Packs the chips the way the browser wraps them: left to right, a new row when the next one
 * does not fit.
 */
function tagsThatFit(widths: number[], moreWidth: (hidden: number) => number, room: number, lines: number, gap: number) {
  const rows = (chips: number[]) => {
    let count = 1, used = 0;
    for (const w of chips) {
      if (used && used + gap + w > room) { count++; used = w; } else used = used ? used + gap + w : w;
    }
    return count;
  };
  for (let n = widths.length; n >= 1; n--) {
    const chips = n === widths.length ? widths : [...widths.slice(0, n), moreWidth(widths.length - n)];
    if (rows(chips) <= lines) return n;
  }
  return 1;
}

/**
 * As many tags as fit on `lines` lines (one by default); when some do not, "+N" counts them.
 * Measured from the card's own width, so a phone shows fewer than a desktop, and measured again
 * when the card resizes.
 */
export function FitTags({ tags, isDark, lines = 1, onTint }: { tags: string[]; isDark?: boolean; lines?: number; onTint?: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(tags.length);
  useEffect(() => {
    const row = rowRef.current, measure = measureRef.current;
    if (!row || !measure) return;
    const fit = () => {
      // The hidden row holds every tag, then "+1", "+2" ... "+(tags - 1)": the room a "+N" chip
      // needs is read from the very chip that would show, not guessed.
      const chips = [...measure.children].map(el => (el as HTMLElement).offsetWidth);
      const widths = chips.slice(0, tags.length);
      setShown(tagsThatFit(widths, hidden => chips[tags.length + hidden - 1] ?? 0, row.clientWidth, lines, 6));
    };
    // The card resizing changes the room; the hidden row resizing (the web font arriving after the
    // first measure) changes the tags' own widths. Either one re-fits.
    const obs = new ResizeObserver(fit);
    obs.observe(row);
    obs.observe(measure);
    return () => obs.disconnect();
  }, [tags, lines]);
  return (
    <div ref={rowRef} className={`relative flex gap-1.5 overflow-hidden ${lines > 1 ? 'flex-wrap' : ''}`}>
      {tags.slice(0, shown).map(tag => <TagChip key={tag} isDark={isDark} onTint={onTint}>{tag}</TagChip>)}
      {shown < tags.length && <TagChip isDark={isDark} onTint={onTint}>+{tags.length - shown}</TagChip>}
      {/* Every tag and every possible "+N", invisible, so their widths can be read whatever is showing. */}
      <div ref={measureRef} aria-hidden="true" className="absolute left-0 top-0 invisible flex gap-1.5">
        {tags.map(tag => <TagChip key={tag} isDark={isDark} onTint={onTint}>{tag}</TagChip>)}
        {tags.slice(1).map((_, i) => <TagChip key={`+${i + 1}`} isDark={isDark} onTint={onTint}>+{i + 1}</TagChip>)}
      </div>
    </div>
  );
}

/**
 * Each tool's stored logo, no frame (some logos carry the tool's name themselves, so the width
 * follows the image); a tool the library has no logo for shows its name. `large` is the detail
 * pages' size, wrapping onto more lines when there are many.
 */
export function ToolLogos({ tools, muted, large }: { tools: string[]; muted: string; large?: boolean }) {
  const toolIcon = useToolIcons();
  return (
    <span className={`flex items-center ${large ? 'flex-wrap gap-3' : 'flex-shrink-0 gap-1.5'}`}>
      {tools.map(tool => toolIcon(tool)
        ? <img key={tool} src={toolIcon(tool)!} alt={tool} title={tool} className={`${large ? 'h-6 max-w-[96px]' : 'h-4 max-w-[60px]'} w-auto object-contain`} />
        : <span key={tool} className={`${large ? 'text-[14px]' : 'text-[12px]'} font-semibold`} style={{ color: muted }}>{tool}</span>)}
    </span>
  );
}

export function CardMeta({ tags = [], level, note, tools = [], isDark, text, muted }: {
  tags?: string[];
  /** Beginner, Intermediate or Advanced. */
  level?: string;
  /** Shown where the level goes when there is none, e.g. a path's "6 learning items". */
  note?: string;
  tools?: string[];
  isDark?: boolean;
  text: string;
  muted: string;
}) {
  if (!tags.length && !level && !note && !tools.length) return null;
  return (
    <div className="mt-auto pt-2.5 flex flex-col gap-2">
      {tags.length > 0 && <FitTags tags={tags} isDark={isDark} />}
      {(level || note || tools.length > 0) && (
        <div className="flex items-center justify-between gap-2 min-h-[22px]">
          {level ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] leading-[18px]" style={{ color: muted }}>
              <LevelBars level={level} color={text} track={isDark ? 'rgba(255,255,255,0.25)' : '#D5DAE1'} />
              {level}
            </span>
          ) : note ? (
            <span className="text-[13px] leading-[18px]" style={{ color: muted }}>{note}</span>
          ) : <span />}
          {tools.length > 0 && <ToolLogos tools={tools} muted={muted} />}
        </div>
      )}
    </div>
  );
}
