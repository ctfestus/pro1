'use client';

// Tool logos: the small marks beside a course category, a dashboard tool row and a learner's
// skills. The built-in set is thirteen names in lib/tool-icons.ts, and a tool outside it used to
// render nothing with nothing explaining why -- so this is where the list stops being code.
//
// An uploaded icon overrides a built-in of the same name rather than replacing it, so the
// defaults always remain as a floor and "remove" means "stop overriding".
//
// Every row uploads for itself. The row already knows its tool name, so sending someone back to
// the field at the top to retype it was pure invented work -- and because that field is offscreen
// once the list is scrolled, filling it in read as nothing having happened at all. The field at
// the top now does one job: naming a tool that is not in the list yet.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Trash2, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadCoverImage } from '@/lib/uploadToCloudinary';
import { DEFAULT_TOOL_ICONS, normalizeToolName, resolveToolIcon } from '@/lib/tool-icons';
import { refreshToolIcons } from '@/lib/use-tool-icons';
import type { ThemeColors } from '@/lib/theme';
import { FIELD, Hint, Label, Sect, inputStyle } from '@/components/create/EditorKit';
import { Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

type Row = { name: string; image: string };
type LoadState = 'ok' | 'network' | 'server';

export function ToolIconsPanel({ C }: { C: ThemeColors }) {
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadState | null>(null);
  const [name, setName]       = useState('');
  // The tool an upload is currently running for, so the spinner appears on the row that was
  // clicked rather than somewhere else on the page.
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef               = useRef<HTMLInputElement>(null);
  // Which tool the file picker was opened for. A ref, not state: the picker is opened in the same
  // tick as the click, and the change event fires long after.
  const targetRef             = useRef<string | null>(null);

  const busy = busyFor !== null;

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/tool-icons');
      if (!res.ok) { setLoadError('server'); return; }
      const { icons } = await res.json();
      setRows(icons ?? []);
    } catch {
      setLoadError('network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uploaded = new Map(rows.map(r => [r.name, r.image]));
  // Built-ins the tenant has not overridden, shown so nobody re-uploads a logo that already works.
  const builtInOnly = Object.keys(DEFAULT_TOOL_ICONS).filter(n => !uploaded.has(n)).sort();

  /** Open the picker for a specific tool, or for whatever is typed in the field when key is null. */
  const pickFor = (key: string | null) => {
    targetRef.current = key;
    fileRef.current?.click();
  };

  const save = async (file: File) => {
    const target = targetRef.current;
    const key = normalizeToolName(target ?? name);
    if (!key) { flash(false, 'Enter the tool name first, exactly as it is typed on courses.'); return; }

    setBusyFor(key);
    try {
      // uploadCoverImage returns a bare public_id for rasters and a full URL for SVGs, which must
      // not get f_auto applied. Both are references the icon resolver understands.
      const image = await uploadCoverImage(file, 'tool-icons');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tool-icons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ name: key, image }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { flash(false, json.error ?? 'Could not save that icon.'); return; }

      refreshToolIcons();
      // Only clear the field if that is what was used -- a row upload never touched it.
      if (!target) setName('');
      flash(true, `Saved. Courses and profiles tagged "${key}" now show this logo.`);
      await load();
    } catch (e: any) {
      flash(false, e?.message || 'Could not upload that image. Check your connection and try again.');
    } finally {
      setBusyFor(null);
      targetRef.current = null;
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (key: string) => {
    if (!window.confirm(`Remove the uploaded logo for "${key}"? The built-in logo, if there is one, applies again.`)) return;
    setRemoving(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tool-icons', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ name: key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { flash(false, json.error ?? 'Could not remove that icon.'); return; }
      refreshToolIcons();
      await load();
    } catch {
      // Deleting the same icon twice is harmless, so an unconfirmed request is safe to repeat.
      flash(false, 'Could not confirm the removal. You can safely try again.');
    } finally {
      setRemoving(null);
    }
  };

  const preview = (key: string, image?: string) => {
    const url = image
      ? resolveToolIcon({ [key]: image }, key)
      : resolveToolIcon(DEFAULT_TOOL_ICONS, key);
    return url
      ? <img src={url} alt="" className="w-6 h-6 object-contain flex-shrink-0"/>
      : <div className="w-6 h-6 rounded flex-shrink-0" style={{ background: C.pill }}/>;
  };

  /** Per-row upload control. Opens the picker already knowing which tool it is for. */
  const rowUploadButton = (key: string, label: string) => (
    <button type="button" onClick={() => pickFor(key)} disabled={busy}
      aria-label={`${label} logo for ${key}`} className={btnSmClass} style={btnStyle('sec', C)}>
      {busyFor === key
        ? <Loader2 className="w-3.5 h-3.5 animate-spin"/>
        : <Upload className="w-3.5 h-3.5"/>}
      {busyFor === key ? 'Uploading' : label}
    </button>
  );
  const row = (key: string, image: string | undefined, children: ReactNode) => (
    <div key={key} className="flex items-center gap-2 sm:gap-3 px-3 py-2 rounded-xl" style={{ background: C.pill }}>
      {preview(key, image)}
      <span className="text-sm flex-1 truncate" style={{ color: C.text }}>{key}</span>
      {children}
    </div>
  );

  return (
    <Sect C={C} title="Tool logos" first>
      <p className="-mt-2 text-xs" style={{ color: C.muted }}>
        The logo shown beside a tool name on course cards, dashboard rows and learner skills.
        Use Replace on any row below, or add a tool that is not listed yet. The name has to
        match what is typed on the course, ignoring capitals and extra spaces. Each upload saves
        straight away.
      </p>

      {/* One hidden picker, shared by the field and every row. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) save(f); }}
      />

      {/* Add a tool that is not in the list yet */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <Label C={C}>Add a tool that is not listed</Label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Looker Studio"
            className={FIELD}
            style={inputStyle(C)}
          />
        </div>
        <button type="button" onClick={() => pickFor(null)} disabled={busy} className={`${btnClass} h-[46px]`} style={btnStyle('pri', C)}>
          {busy && !targetRef.current ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
          {busy && !targetRef.current ? 'Uploading' : 'Upload logo'}
        </button>
      </div>

      {msg && (
        <div role={msg.ok ? 'status' : 'alert'} className="flex items-start gap-2 text-xs px-3 py-3 rounded-xl"
          style={msg.ok ? { background: C.successBg, color: C.successText } : { background: C.errorBg, color: C.errorText }}>
          {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>}
          {msg.text}
        </div>
      )}

      {/* Current set */}
      {loading ? (
        <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" style={{ color: C.faint }}/></div>
      ) : loadError ? (
        <div className="py-6 text-center space-y-2">
          <p className="text-xs" style={{ color: C.muted }}>
            {loadError === 'network'
              ? 'Could not load the tool logos. Check your connection and try again.'
              : 'Could not load the tool logos right now. Try again.'}
          </p>
          <button type="button" onClick={load} className={btnSmClass} style={btnStyle('sec', C)}>Retry</button>
        </div>
      ) : (
        <div className="grid gap-2">
          {rows.map(r => row(r.name, r.image, <>
            <span className="hidden sm:inline"><Pill tone="good" dot C={C}>Uploaded</Pill></span>
            {rowUploadButton(r.name, 'Replace')}
            <button type="button" onClick={() => remove(r.name)} disabled={removing === r.name || busy}
              aria-label={`Remove ${r.name} logo`}
              className="w-8 h-8 rounded-[10px] grid place-items-center disabled:opacity-50 transition-opacity hover:opacity-70">
              {removing === r.name
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: C.faint }}/>
                : <Trash2 className="w-3.5 h-3.5" style={{ color: palette(C).bad }}/>}
            </button>
          </>))}

          {builtInOnly.map(key => row(key, undefined, <>
            <span className="hidden sm:inline"><Pill tone="mute" C={C}>Built in</Pill></span>
            {rowUploadButton(key, 'Replace')}
          </>))}
        </div>
      )}
    </Sect>
  );
}
