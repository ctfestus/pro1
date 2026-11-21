'use client';

// Account settings, Portfolio step: up to five embedded pieces of work.

import { useState, type Dispatch, type SetStateAction } from 'react';
import { Image as ImageIcon, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { sanitizePlainText } from '@/lib/sanitize';
import { deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { useToolIcons } from '@/lib/use-tool-icons';
import { FIELD, Hint, Label, Sect } from '@/components/create/EditorKit';
import { Card, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { EntryCard, TOOLS, panelField, type PortfolioItem } from './shared';

export function PortfolioStep({ C, items, setItems, uploadToStorage }: {
  C: ThemeColors; items: PortfolioItem[]; setItems: Dispatch<SetStateAction<PortfolioItem[]>>;
  uploadToStorage: (file: File, folder: string, oldUrl?: string) => Promise<string | null>;
}) {
  const P = palette(C);
  const toolIcon = useToolIcons();
  const [thumbUploading, setThumbUploading] = useState<string | null>(null);
  const update = (i: number, patch: Partial<PortfolioItem>) => setItems(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x));

  return (
    <Card C={C}>
      <Sect title="Portfolio" first C={C}
        action={items.length < 5 && (
          <button type="button" className={btnSmClass} style={btnStyle('sec', C)}
            onClick={() => setItems(prev => [...prev, { id: crypto.randomUUID(), title: '', tools: [], url: '', thumbnail_url: '', description: '' }])}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}>
        <Hint C={C}>Embed Canva, Power BI, Tableau, Jupyter and more. Paste the public share URL.</Hint>
        {items.length === 0 && <p className="text-sm" style={{ color: C.muted }}>No portfolio items added yet. Up to 5 items.</p>}
        {items.map((item, i) => (
          <EntryCard key={item.id} label="Remove this item" C={C} onDelete={() => {
            if (item.thumbnail_url) deleteFromCloudinary(item.thumbnail_url).catch(() => {});
            setItems(prev => prev.filter((_, j) => j !== i));
          }}>
            <div>
              <Label C={C}>Title</Label>
              <input value={item.title} onChange={e => update(i, { title: sanitizePlainText(e.target.value) })} placeholder="For example Sales Dashboard" className={FIELD} style={panelField(C)} />
            </div>
            <div>
              <Label C={C}>Tools used</Label>
              <div className="flex flex-wrap gap-2">
                {TOOLS.map(tool => {
                  const active = (item.tools ?? []).includes(tool);
                  return (
                    <button key={tool} type="button" aria-pressed={active}
                      onClick={() => update(i, { tools: active ? item.tools.filter(t => t !== tool) : [...item.tools, tool] })}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold"
                      style={active ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted }}>
                      {toolIcon(tool) && <img src={toolIcon(tool)} alt="" style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0 }} />}
                      {tool}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label C={C}>Embed URL</Label>
              <input value={item.url} onChange={e => update(i, { url: e.target.value.trim() })}
                placeholder="https://www.canva.com/design/... or a Power BI, Tableau or Jupyter URL" className={FIELD} style={panelField(C)} />
              {item.url && !item.url.startsWith('https://') && <Hint C={C} tone={P.bad}>URL must start with https://</Hint>}
            </div>
            <div>
              <Label C={C}>Thumbnail (optional)</Label>
              <div className="flex items-center gap-3">
                {item.thumbnail_url
                  ? <img src={item.thumbnail_url} alt="Thumbnail" className="w-20 h-14 rounded-lg object-cover flex-shrink-0" />
                  : <span className="w-20 h-14 rounded-lg grid place-items-center flex-shrink-0" style={{ background: C.card }}><ImageIcon className="w-5 h-5" style={{ color: C.faint }} /></span>}
                <div className="min-w-0 grid gap-1.5">
                  <div className="flex flex-wrap gap-2">
                    <label className={`${btnSmClass} cursor-pointer`} style={btnStyle('sec', C)}>
                      <input type="file" accept="image/*" className="hidden" onChange={async e => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 8 * 1024 * 1024) { alert('Image must be 8 MB or smaller.'); return; }
                        setThumbUploading(item.id);
                        const url = await uploadToStorage(f, 'portfolio-thumbnails', item.thumbnail_url || undefined);
                        if (url) setItems(prev => prev.map((x, j) => j === i ? { ...x, thumbnail_url: url } : x));
                        setThumbUploading(null);
                        e.target.value = '';
                      }} />
                      {thumbUploading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {thumbUploading === item.id ? 'Uploading...' : item.thumbnail_url ? 'Replace' : 'Upload'}
                    </label>
                    {item.thumbnail_url && (
                      <button type="button" onClick={() => update(i, { thumbnail_url: '' })} className={btnSmClass} style={btnStyle('danger', C)}>
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: C.muted }}>Used as cover when the embed cannot be previewed.</p>
                </div>
              </div>
            </div>
            <div>
              <Label C={C}>Description (optional)</Label>
              <textarea value={item.description} onChange={e => update(i, { description: sanitizePlainText(e.target.value).slice(0, 200) })}
                placeholder="Brief description of this work" rows={3} maxLength={200} className={`${FIELD} resize-none`} style={panelField(C)} />
              <p className="text-right text-xs mt-1" style={{ color: item.description.length >= 180 ? P.bad : C.faint }}>{item.description.length}/200</p>
            </div>
          </EntryCard>
        ))}
      </Sect>
    </Card>
  );
}
