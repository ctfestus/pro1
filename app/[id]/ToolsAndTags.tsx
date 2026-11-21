'use client';

// The tools and tags at the top of a course, experience or path page's side card, drawn the way
// the catalogue cards draw them: each tool's logo (its name when it has none), then the tags as
// grey chips. Each detail page has its own palette, so the colours come in.

import { ToolLogos } from '@/components/CardMeta';

export function ToolsAndTags({ tools = [], tags = [], palette }: {
  tools?: string[];
  tags?: string[];
  palette: { label: string; chip: string; chipText: string };
}) {
  const toolList = tools.map(tool => String(tool ?? '').trim()).filter(Boolean);
  const tagList = [...new Set(tags.map(tag => String(tag ?? '').trim()).filter(Boolean))];
  const label = (text: string) => (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: palette.label }}>{text}</p>
  );
  return (
    <>
      {toolList.length > 0 && (
        <div>
          {label('Tools')}
          <ToolLogos tools={[...new Set(toolList)]} muted={palette.chipText} large />
        </div>
      )}
      {tagList.length > 0 && (
        <div>
          {label('Tags')}
          <div className="flex flex-wrap gap-1.5">
            {tagList.map(tag => (
              <span key={tag} className="inline-flex h-[22px] items-center rounded-md px-2 text-[12px] font-medium"
                style={{ background: palette.chip, color: palette.chipText }}>{tag}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
