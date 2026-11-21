'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { sanitizeAnnouncementContent, sanitizePlainText } from '@/lib/sanitize';
import { DateTimeField } from '@/components/DatePicker';
import { Card, Pill, btnClass, btnSmClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { CoverField, EditorHeader, FIELD, Hint, Label, Sect, SwitchRow, TickList, inputStyle, useEditorC } from '@/components/create/EditorKit';

// -- Format a date for datetime-local input ---
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Page ---
export default function CreateAnnouncementPage() {
  const C = useEditorC();
  const router = useRouter();

  const [editId, setEditId]             = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const [title, setTitle]               = useState('');
  const [subtitle, setSubtitle]         = useState('');
  const [subtitleGenerating, setSubtitleGenerating] = useState(false);
  const [content, setContent]           = useState('');
  const [coverImage, setCoverImage]     = useState('');
  const [youtubeUrl, setYoutubeUrl]     = useState('');
  const [isPinned, setIsPinned]         = useState(false);
  const [publishedAt, setPublishedAt]   = useState(() => toDatetimeLocalValue(new Date()));
  const [expiresAt, setExpiresAt]       = useState('');
  const [cohorts, setCohorts]           = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const originalCohortIds = useRef<string[]>([]);
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase.from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin'].includes(profile.role)) { router.replace('/dashboard'); return; }

      const { data: c } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      if (c) setCohorts(c);

      if (id) {
        const { data } = await supabase.from('announcements').select('*').eq('id', id).single();
        if (data) {
          setTitle(data.title ?? '');
          setSubtitle(data.subtitle ?? '');
          setContent(data.content ?? '');
          setCoverImage(data.cover_image ?? '');
          setYoutubeUrl(data.youtube_url ?? '');
          setIsPinned(data.is_pinned ?? false);
          if (data.published_at) setPublishedAt(toDatetimeLocalValue(new Date(data.published_at)));
          if (data.expires_at) setExpiresAt(toDatetimeLocalValue(new Date(data.expires_at)));
          if (data.cohort_ids?.length) {
            setSelectedCohortIds(data.cohort_ids);
            originalCohortIds.current = data.cohort_ids;
          }
        }
      }
    };
    init();
  }, [router]);

  async function generateSubtitle() {
    if (!content.trim()) { setError('Write some content first so the AI has something to work with.'); return; }
    setSubtitleGenerating(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/announcement-subtitle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setSubtitle(json.subtitle ?? '');
    } catch (err: any) {
      setError(err.message || 'Could not generate subtitle.');
    } finally {
      setSubtitleGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedTitle   = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle)   { setError('Title is required.'); return; }
    if (!trimmedContent) { setError('Content is required.'); return; }

    const publishedDate = new Date(publishedAt);
    const expiresDate   = expiresAt ? new Date(expiresAt) : null;
    if (expiresDate && expiresDate <= publishedDate) { setError('Expiry date must be after the published date.'); return; }

    setLoading(true);
    try {
      const payload = {
        title: trimmedTitle, subtitle: subtitle.trim() || null, content: sanitizeAnnouncementContent(content), cover_image: coverImage.trim() || null,
        youtube_url: youtubeUrl.trim() || null,
        is_pinned: isPinned, cohort_ids: selectedCohortIds,
        published_at: publishedDate.toISOString(), expires_at: expiresDate ? expiresDate.toISOString() : null,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      let addedCohortIds: string[] = [];
      if (editId) {
        const { error: e } = await supabase.from('announcements').update(payload).eq('id', editId);
        if (e) throw e;
        // Detect newly added cohorts
        addedCohortIds = selectedCohortIds.filter(id => !originalCohortIds.current.includes(id));
      } else {
        const { error: e } = await supabase.from('announcements').insert({ ...payload, author_id: session.user.id });
        if (e) throw e;
        // On create, all selected cohorts are new
        addedCohortIds = selectedCohortIds;
      }


      router.push('/dashboard#announcements');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const field = inputStyle(C);
  const embedId = youtubeUrl.trim() ? youtubeUrl.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1] : undefined;

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      <form onSubmit={handleSubmit} noValidate className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <EditorHeader C={C} back="All announcements" onBack={() => router.push('/dashboard#announcements')}
          title={title.trim() || (editId ? 'Edit announcement' : 'New announcement')}
          pill={isPinned ? <Pill tone="mute" C={C}>Pinned</Pill> : undefined}
          error={error} onDismissError={() => setError('')}
          actions={
            <button type="submit" disabled={loading} className={btnClass} style={btnStyle('pri', C)}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Saving...' : editId ? 'Save changes' : 'Publish'}
            </button>
          } />

        <Card C={C} className="mt-4">
          <Sect C={C} title="Announcement" first>
            <div>
              <Label C={C}>Title</Label>
              <input type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                placeholder="For example Important update for all students" className={FIELD} style={field} maxLength={255} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold" style={{ color: C.muted }}>Subtitle</span>
                <button type="button" onClick={generateSubtitle} disabled={subtitleGenerating} className={btnSmClass} style={btnStyle('sec', C)}>
                  {subtitleGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {subtitleGenerating ? 'Writing...' : 'Write with AI'}
                </button>
              </div>
              <input type="text" value={subtitle} onChange={e => setSubtitle(sanitizePlainText(e.target.value))} aria-label="Subtitle"
                placeholder="A short line shown on the card preview" className={FIELD} style={field} maxLength={200} />
              <Hint C={C}>Optional. Shown as the teaser on the card.</Hint>
            </div>
            <div>
              <Label C={C}>Content</Label>
              <RichTextEditor value={content} onChange={setContent} placeholder="Write your announcement here" enableAiAssist enableVideoEmbed />
            </div>
          </Sect>

          <Sect C={C} title="Media">
            <CoverField C={C} label="Cover image" value={coverImage} onChange={setCoverImage} />
            <div>
              <Label C={C}>YouTube video</Label>
              <input type="url" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v= or https://youtu.be/" className={FIELD} style={field} />
              {!youtubeUrl.trim() ? (
                <Hint C={C}>Optional. A preview shows here once the link is recognised.</Hint>
              ) : embedId ? (
                <div className="mt-3 rounded-xl overflow-hidden relative max-w-xl" style={{ paddingBottom: '56.25%', height: 0 }}>
                  <iframe src={`https://www.youtube.com/embed/${embedId}`} title="YouTube preview"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                    className="absolute inset-0 w-full h-full border-0" />
                </div>
              ) : (
                <Hint C={C} tone={C.errorText}>Could not read this YouTube link. Paste a standard YouTube link.</Hint>
              )}
            </div>
          </Sect>

          <Sect C={C} title="When it shows">
            <SwitchRow C={C} title="Pin to the top" sub="Pinned announcements appear at the top of the feed." on={isPinned} onChange={setIsPinned} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label C={C}>Published</Label>
                <DateTimeField label="Published at" placeholder="Choose a date" value={publishedAt} onChange={setPublishedAt} C={C} />
              </div>
              <div>
                <Label C={C}>Expires</Label>
                <DateTimeField label="Expires at" placeholder="Never expires" value={expiresAt} onChange={setExpiresAt} defaultTime="23:59" C={C} />
              </div>
            </div>
          </Sect>

          {cohorts.length > 0 && (
            <Sect C={C} title="Cohorts" aside={`${selectedCohortIds.length} selected`}>
              <TickList C={C} items={cohorts} selected={selectedCohortIds} onToggle={toggleCohort} />
            </Sect>
          )}
        </Card>
      </form>
    </div>
  );
}
