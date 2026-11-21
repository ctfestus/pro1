'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { ArrowLeft, ArrowRight, Plus, Loader2, X, Check, Paperclip, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { sanitizeRichText } from '@/lib/sanitize';
import { deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { RichTextEditor } from '@/components/RichTextEditor';
import { safeEmbedUrl } from '@/lib/safe-embed-url';
import { AttachmentPicker } from '@/components/AttachmentPicker';
import { formatAttachmentSize } from '@/lib/lesson-attachment';
import { Card, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { CoverField, EditorHeader, FIELD, Hint, Label, Sect, TickList, inputStyle, useEditorC } from '@/components/create/EditorKit';
import {
  isUploadedAttachmentUrl, normalizeRecordingAttachments, recordingAttachmentBadge,
  type RecordingAttachment,
} from '@/lib/recording-attachments';

// --- Design tokens: standard palette from lib/theme.ts ---

interface Entry {
  id: string;
  week: number;
  topic: string;
  url: string;
  description: string;
  attachments: RecordingAttachment[];
}

export default function CreateRecordingPage() {
  const C = useEditorC();
  const router = useRouter();

  const [editId, setEditId]   = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // Fields
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [coverImage, setCoverImage]         = useState('');
  const [originalCoverImage, setOriginalCoverImage] = useState('');
  // The status as last saved, for the header pill; each save button sets the status it saves.
  const [savedStatus, setSavedStatus]   = useState<'draft' | 'published'>('draft');
  const [tab, setTab]                   = useState<'details' | 'sessions'>('details');
  const [cohorts, setCohorts]           = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [entries, setEntries]           = useState<Entry[]>([]);
  // One session is open beside the list. A session the author just added opens with the cursor
  // in Topic, since the next thing they do is type into it.
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [justAddedId, setJustAddedId]   = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [originalWeeks, setOriginalWeeks] = useState<Set<number>>(new Set());

  // Sessions in the order they show and save: by week, then as added.
  const weeks = [...new Set(entries.map(e => e.week))].sort((a, b) => a - b);
  const ordered = weeks.flatMap(w => entries.filter(e => e.week === w));

  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase
        .from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin', 'staff'].includes(profile.role)) {
        router.replace('/dashboard'); return;
      }

      const { data: cohortsData } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      if (cohortsData) setCohorts(cohortsData);

      if (id) {
        const [{ data: rec }, { data: entriesData }] = await Promise.all([
          supabase.from('recordings').select('*').eq('id', id).single(),
          supabase.from('recording_entries').select('*').eq('recording_id', id)
            .order('week').order('order_index'),
        ]);
        if (rec) {
          setTitle(rec.title ?? '');
          setDescription(rec.description ?? '');
          setCoverImage(rec.cover_image ?? '');
          setOriginalCoverImage(rec.cover_image ?? '');
          setSavedStatus(rec.status ?? 'draft');
          if (rec.cohort_ids?.length) setSelectedCohortIds(rec.cohort_ids);
        }
        if (entriesData) {
          setEntries(entriesData.map((e: any) => ({
            id: e.id, week: e.week, topic: e.topic, url: e.url,
            description: e.description ?? '',
            attachments: normalizeRecordingAttachments(e.attachments),
          })));
          setOriginalWeeks(new Set(entriesData.map((e: any) => e.week)));
          setSelectedId(entriesData[0]?.id ?? null);
        }
      }
    };
    init();
  }, [router]);

  // With no week given the session joins the last week; Add week passes the next one.
  function addEntry(week?: number) {
    const maxWeek = entries.length ? Math.max(...entries.map(e => e.week)) : 1;
    const id = crypto.randomUUID();
    setEntries(prev => [...prev, {
      id, week: week ?? maxWeek, topic: '', url: '',
      description: '', attachments: [],
    }]);
    openSession(id);
    setJustAddedId(id);
  }
  function openSession(id: string) {
    setSelectedId(id);
    // On a phone the open session sits below the list, so bring it into view.
    if (window.innerWidth < 1024) requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  function removeEntry(id: string) {
    const i = ordered.findIndex(e => e.id === id);
    const next = ordered[i + 1] ?? ordered[i - 1];
    setEntries(prev => prev.filter(e => e.id !== id));
    setSelectedId(next ? next.id : null);
  }
  function updateEntry<K extends keyof Entry>(id: string, field: K, value: Entry[K]) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }
  function addAttachment(id: string, attachment: RecordingAttachment) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, attachments: [...e.attachments, attachment] } : e));
  }
  // Removal only drops the reference. The uploaded object stays: nothing is saved until
  // the form is submitted, so deleting it here would break the live session for students
  // whenever an author removes a resource and then cancels. Same trade lesson attachments
  // make -- an orphaned object costs storage, a deleted one costs a broken download.
  function removeAttachment(id: string, attachmentId: string) {
    setEntries(prev => prev.map(e => e.id === id
      ? { ...e, attachments: e.attachments.filter(a => a.id !== attachmentId) }
      : e));
  }

  async function save(status: 'draft' | 'published') {
    setError('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setTab('details'); setError('Title is required.'); return; }
    const unfinished = ordered.find(e => !e.topic.trim() || !e.url.trim());
    if (unfinished) {
      setTab('sessions'); setSelectedId(unfinished.id);
      setError('Each session must have a topic and a video link.'); return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const payload = {
        title: trimmedTitle,
        description: sanitizeRichText(description) || null,
        cover_image: coverImage.trim() || null,
        cohort_ids: selectedCohortIds,
        status,
      };

      let recId = editId;
      if (editId) {
        const { error: e } = await supabase.from('recordings').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId);
        if (e) throw e;
        if (originalCoverImage && originalCoverImage !== coverImage.trim()) {
          await deleteFromCloudinary(originalCoverImage).catch(() => {});
        }
        await supabase.from('recording_entries').delete().eq('recording_id', editId);
      } else {
        const { data, error: e } = await supabase.from('recordings')
          .insert({ ...payload, created_by: session.user.id }).select('id').single();
        if (e) throw e;
        recId = data!.id;
        // The recording row exists from here on. If saving the sessions below fails the
        // author stays on this page with everything still typed in, so adopt the row as
        // the edit target -- without this, pressing Save again creates a second recording.
        // The URL follows so a reload continues editing the same row rather than a third.
        setEditId(recId);
        window.history.replaceState(null, '', `/create/recording?edit=${recId}`);
      }

      if (entries.length) {
        const rows = ordered.map((en, idx) => ({
          recording_id: recId,
          week: en.week,
          topic: en.topic.trim(),
          url: en.url.trim(),
          description: sanitizeRichText(en.description) || null,
          attachments: en.attachments,
          order_index: idx,
        }));
        const { error: entErr } = await supabase.from('recording_entries').insert(rows);
        if (entErr) throw entErr;
      }

      // Notify if: new recording published, OR existing published recording has new weeks added
      const currentWeeks = entries.map(e => e.week);
      const addedWeeks = !editId
        ? [...new Set(currentWeeks)]
        : [...new Set(currentWeeks)].filter(w => !originalWeeks.has(w));
      if (status === 'published' && recId && addedWeeks.length > 0) {
        fetch('/api/recording-notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ recordingId: recId, newWeeks: addedWeeks }),
        }).catch(() => {});
      }

      router.push('/dashboard?section=recordings');
    } catch (err: any) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const P = palette(C);
  const field = inputStyle(C);
  const selectedIndex = ordered.findIndex(e => e.id === selectedId);
  const selected = selectedIndex >= 0 ? ordered[selectedIndex] : null;

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <EditorHeader C={C} back="All recordings" onBack={() => router.push('/dashboard?section=recordings')}
          title={title.trim() || (editId ? 'Edit recording' : 'New recording')}
          pill={savedStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
          error={error} onDismissError={() => setError('')}
          actions={<>
            <button type="button" onClick={() => save('draft')} disabled={saving} className={btnClass} style={btnStyle('sec', C)}>
              <Check className="w-4 h-4" /> Save draft
            </button>
            <button type="button" onClick={() => save('published')} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {savedStatus === 'published' ? 'Publish changes' : 'Publish'}
            </button>
          </>}>
          <div role="tablist" aria-label="Recording steps" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
            {([['details', 'Details'], ['sessions', 'Sessions']] as const).map(([id, label]) => {
              const active = tab === id;
              return (
                <button key={id} type="button" role="tab" aria-selected={active} onClick={() => setTab(id)}
                  className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
                  style={active ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                  {label}{id === 'sessions' && <span className="ml-1 text-xs" style={{ opacity: 0.7 }}>{entries.length}</span>}
                </button>
              );
            })}
          </div>
        </EditorHeader>

        {tab === 'details' && (
          <Card C={C} className="mt-4">
            <Sect C={C} title="About the recording" first>
              <div>
                <Label C={C}>Course or programme title</Label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="For example Microsoft Excel Masterclass" className={FIELD} style={field} />
              </div>
              <div>
                <Label C={C}>Description</Label>
                <RichTextEditor value={description} onChange={setDescription} placeholder="Brief overview of the programme or course" enableAiAssist />
              </div>
            </Sect>
            <Sect C={C} title="Cover">
              <CoverField C={C} value={coverImage} onChange={setCoverImage} />
            </Sect>
            <Sect C={C} title="Cohorts" aside={`${selectedCohortIds.length} selected`}>
              <p className="text-xs" style={{ color: C.muted }}>Only students in selected cohorts see these recordings.</p>
              {cohorts.length === 0
                ? <p className="text-sm" style={{ color: C.muted }}>No bootcamp cohorts yet.</p>
                : <TickList C={C} items={cohorts} selected={selectedCohortIds} onToggle={toggleCohort} />}
            </Sect>
          </Card>
        )}

        {tab === 'sessions' && (
          <div className="mt-4 grid gap-4 items-start lg:grid-cols-[300px_minmax(0,1fr)]">
            <Card C={C} className="lg:sticky lg:top-4">
              <Sect C={C} title="Sessions" aside={`${entries.length} session${entries.length === 1 ? '' : 's'}`} first>
                {weeks.length === 0 && <p className="text-xs" style={{ color: C.muted }}>No sessions yet. Each session takes a week number, a topic and a video link.</p>}
                {weeks.map(week => (
                  <div key={week}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold" style={{ color: C.muted }}>Week {week}</span>
                      <button type="button" onClick={() => addEntry(week)} aria-label={`Add a session to week ${week}`} title={`Add a session to week ${week}`}
                        className="w-7 h-7 rounded-lg grid place-items-center hover:opacity-80" style={{ color: C.muted }}>
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {ordered.filter(e => e.week === week).map(entry => {
                      const on = entry.id === selectedId;
                      const ready = !!entry.url.trim() && !!entry.topic.trim();
                      return (
                        <button key={entry.id} type="button" onClick={() => openSession(entry.id)} aria-current={on || undefined}
                          className="w-full flex items-start gap-2.5 p-2.5 rounded-[10px] text-left"
                          style={on ? { background: C.page, boxShadow: `inset 3px 0 0 ${P.sel}` } : undefined}>
                          <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: ready ? P.good : P.warn }} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold truncate" style={{ color: entry.topic.trim() ? C.text : C.muted }}>{entry.topic.trim() || 'Untitled session'}</span>
                            <span className="block text-xs" style={{ color: C.muted }}>{sessionSummary(entry)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => addEntry()} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add session</button>
                  {entries.length > 0 && (
                    <button type="button" onClick={() => addEntry(Math.max(...entries.map(e => e.week)) + 1)} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add week</button>
                  )}
                </div>
              </Sect>
            </Card>

            <div ref={editorRef} className="min-w-0 scroll-mt-4">
              <Card C={C}>
                {selected ? (
                  <SessionEditor key={selected.id} entry={selected} C={C} autoFocus={selected.id === justAddedId}
                    place={`Week ${selected.week}, session ${ordered.filter(e => e.week === selected.week).indexOf(selected) + 1} of ${ordered.filter(e => e.week === selected.week).length}`}
                    onUpdate={updateEntry} onRemove={removeEntry}
                    onAddAttachment={addAttachment} onRemoveAttachment={removeAttachment}
                    footer={
                      <div className="p-5 flex flex-wrap items-center justify-between gap-2" style={{ borderTop: `1px solid ${C.divider}` }}>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setSelectedId(ordered[selectedIndex - 1].id)} disabled={selectedIndex === 0}
                            className={btnSmClass} style={btnStyle('sec', C)}><ArrowLeft className="w-3.5 h-3.5" /> Previous</button>
                          <button type="button" onClick={() => setSelectedId(ordered[selectedIndex + 1].id)} disabled={selectedIndex === ordered.length - 1}
                            className={btnSmClass} style={btnStyle('sec', C)}>Next <ArrowRight className="w-3.5 h-3.5" /></button>
                        </div>
                        <button type="button" onClick={() => addEntry(selected.week)} className={btnClass} style={btnStyle('sec', C)}>
                          <Plus className="w-4 h-4" /> Add the next session to week {selected.week}
                        </button>
                      </div>
                    } />
                ) : (
                  <div className="p-8 text-center">
                    <p className="text-sm font-semibold" style={{ color: C.text }}>No sessions yet</p>
                    <p className="text-sm mt-1" style={{ color: C.muted }}>Add your first session to start building this programme.</p>
                    <button type="button" onClick={() => addEntry()} className={`${btnClass} mt-4`} style={btnStyle('sec', C)}><Plus className="w-4 h-4" /> Add session</button>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// What a list row has to say for itself: whether this session is finished.
function sessionSummary(entry: Entry) {
  const url = entry.url.trim();
  return [
    url ? (safeEmbedUrl(url) ? 'Plays in app' : 'Opens in a new tab') : 'No video link yet',
    entry.attachments.length ? `${entry.attachments.length} file${entry.attachments.length !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ');
}

// The open session. Kept in this file because only this editor renders it; it holds the
// picker's open/closed state so two sessions can never share one dialog.
function SessionEditor({ entry, place, C, autoFocus, footer, onUpdate, onRemove, onAddAttachment, onRemoveAttachment }: {
  entry: Entry;
  place: string;
  C: ThemeColors;
  autoFocus: boolean;
  footer: React.ReactNode;
  onUpdate: <K extends keyof Entry>(id: string, field: K, value: Entry[K]) => void;
  onRemove: (id: string) => void;
  onAddAttachment: (id: string, attachment: RecordingAttachment) => void;
  onRemoveAttachment: (id: string, attachmentId: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const P = palette(C);
  const field = inputStyle(C);
  // Say it while the link is being pasted, not after a student finds out: only some hosts
  // can be framed, and the rest send the student off the platform.
  const playsInApp = !!safeEmbedUrl(entry.url.trim());

  return (
    <>
      <Sect C={C} first title={entry.topic.trim() || 'Untitled session'} aside={place}
        action={
          <button type="button" onClick={() => onRemove(entry.id)} aria-label="Delete session" title="Delete session"
            className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}>
            <Trash2 className="w-4 h-4" />
          </button>
        }>
        <div className="flex flex-wrap gap-3">
          <div className="w-24 flex-shrink-0">
            <Label C={C}>Week</Label>
            <input type="number" min={1} value={entry.week}
              onChange={e => onUpdate(entry.id, 'week', parseInt(e.target.value) || 1)} className={FIELD} style={field} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label C={C}>Topic</Label>
            <input value={entry.topic} onChange={e => onUpdate(entry.id, 'topic', e.target.value)} autoFocus={autoFocus}
              placeholder="For example Introduction to Pivot Tables" className={FIELD} style={field} />
          </div>
        </div>

        <div>
          <Label C={C}>Video link</Label>
          <input value={entry.url} onChange={e => onUpdate(entry.id, 'url', e.target.value)} placeholder="https://youtu.be/" className={FIELD} style={field} />
          <Hint C={C} tone={playsInApp ? P.good : C.muted}>
            {!entry.url.trim()
              ? 'YouTube, Vimeo, Canva and Bunny links play inside the app. Anything else opens in a new tab.'
              : playsInApp
                ? 'Plays inside the app.'
                : 'Students will open this one in a new tab. Paste a YouTube, Vimeo, Canva or Bunny link to have it play here.'}
          </Hint>
        </div>

        <div>
          <Label C={C}>Session notes</Label>
          <RichTextEditor value={entry.description} onChange={html => onUpdate(entry.id, 'description', html)}
            placeholder="What this class covered, homework, timestamps" enableAiAssist />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold" style={{ color: C.muted }}>Resources</span>
            <button type="button" onClick={() => setShowPicker(true)} className={btnSmClass} style={btnStyle('sec', C)}>
              <Paperclip className="w-3.5 h-3.5" /> Add file or link
            </button>
          </div>
          {entry.attachments.length === 0
            ? <p className="text-xs" style={{ color: C.muted }}>No resources yet. Upload the workbook or slides, or paste a link.</p>
            : (
              <div className="rounded-xl p-2 grid gap-1" style={{ background: C.page }}>
                {entry.attachments.map(att => {
                  const size = formatAttachmentSize(att.size);
                  return (
                    <div key={att.id} className="flex items-center gap-3 px-2 py-2">
                      <Pill tone="mute" C={C}>{recordingAttachmentBadge(att)}</Pill>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{att.name}</p>
                        <p className="text-xs" style={{ color: C.muted }}>
                          {att.kind === 'file' ? (size ? `Uploaded file, ${size}` : 'Uploaded file') : 'External link'}
                        </p>
                      </div>
                      <button type="button" onClick={() => onRemoveAttachment(entry.id, att.id)} aria-label={`Remove ${att.name}`}
                        className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ color: C.muted }}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </Sect>
      {footer}

      {showPicker && (
        <AttachmentPicker
          folder="recording-files"
          onSelect={picked => {
            onAddAttachment(entry.id, {
              id: crypto.randomUUID(),
              name: picked.fileName || 'Attached file',
              url: picked.href,
              kind: isUploadedAttachmentUrl(picked.href) ? 'file' : 'link',
              size: picked.fileSize,
            });
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}
