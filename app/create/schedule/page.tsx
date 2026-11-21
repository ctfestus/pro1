'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Check, Plus, Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { sanitizeRichText, sanitizePlainText } from '@/lib/sanitize';
import { DateField } from '@/components/DatePicker';
import { MenuSelect } from '@/components/MenuSelect';
import { Card, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { CoverField, EditorHeader, FIELD, Label, Sect, TickList, inputStyle, useEditorC } from '@/components/create/EditorKit';

// --- Design tokens: standard palette from lib/theme.ts ---

// --- Types ---
interface Topic {
  id: string;
  name: string;
  description: string;
}

interface Resource {
  id: string;
  name: string;
  url: string;
}

interface Course {
  id: string;
  title: string;
}

// --- Page ---
export default function CreateSchedulePage() {
  const C = useEditorC();
  const router = useRouter();

  const [editId, setEditId]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [courses, setCourses]   = useState<Course[]>([]);

  // Form fields
  const [title, setTitle]           = useState('');
  const [courseId, setCourseId]     = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage]     = useState('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  // The status as last saved, for the header pill; each save button sets the status it saves.
  const [savedStatus, setSavedStatus] = useState<'draft' | 'published'>('draft');
  const [topics, setTopics]         = useState<Topic[]>([]);
  const [resources, setResources]   = useState<Resource[]>([]);
  const [cohorts, setCohorts]       = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase
        .from('students')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['instructor', 'admin'].includes(profile.role)) {
        router.replace('/dashboard');
        return;
      }

      const [{ data: coursesData }, { data: cohortsData }] = await Promise.all([
        supabase.from('courses').select('id, title').eq('user_id', session.user.id).order('title'),
        supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name'),
      ]);
      if (coursesData) setCourses(coursesData);
      if (cohortsData) setCohorts(cohortsData);

      if (id) {
        const [{ data: scheduleData }, { data: topicsData }, { data: resourcesData }] = await Promise.all([
          supabase.from('schedules').select('*').eq('id', id).single(),
          supabase.from('schedule_topics').select('*').eq('schedule_id', id).order('order_index', { ascending: true }),
          supabase.from('schedule_resources').select('*').eq('schedule_id', id).order('created_at', { ascending: true }),
        ]);

        if (scheduleData) {
          setTitle(scheduleData.title ?? '');
          setCourseId(scheduleData.course_id ?? '');
          setDescription(scheduleData.description ?? '');
          setCoverImage(scheduleData.cover_image ?? '');
          setStartDate(scheduleData.start_date ?? '');
          setEndDate(scheduleData.end_date ?? '');
          setSavedStatus(scheduleData.status ?? 'draft');
          if (scheduleData.cohort_ids?.length) setSelectedCohortIds(scheduleData.cohort_ids);
        }
        if (topicsData) setTopics(topicsData.map((t: any) => ({ id: t.id, name: t.name, description: t.description ?? '' })));
        if (resourcesData) setResources(resourcesData.map((r: any) => ({ id: r.id, name: r.name, url: r.url })));
      }
    };
    init();
  }, [router]);

  // -- Topics helpers ---
  function addTopic() {
    setTopics(prev => [...prev, { id: crypto.randomUUID(), name: '', description: '' }]);
  }
  function removeTopic(id: string) {
    setTopics(prev => prev.filter(t => t.id !== id));
  }
  function updateTopic(id: string, field: 'name' | 'description', value: string) {
    setTopics(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  }

  // -- Resources helpers ---
  function addResource() {
    setResources(prev => [...prev, { id: crypto.randomUUID(), name: '', url: '' }]);
  }
  function removeResource(id: string) {
    setResources(prev => prev.filter(r => r.id !== id));
  }
  function updateResource(id: string, field: 'name' | 'url', value: string) {
    setResources(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // -- Save ---
  async function save(status: 'draft' | 'published') {
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }

    if (startDate && endDate && endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const payload = {
        title: trimmedTitle,
        course_id: courseId || null,
        description: sanitizeRichText(description) || null,
        cover_image: coverImage.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        cohort_ids: selectedCohortIds,
      };

      let scheduleId = editId;
      if (editId) {
        const { error: scheduleError } = await supabase.from('schedules').update(payload).eq('id', editId);
        if (scheduleError) throw scheduleError;
        await supabase.from('schedule_topics').delete().eq('schedule_id', editId);
        await supabase.from('schedule_resources').delete().eq('schedule_id', editId);
      } else {
        const { data: schedule, error: scheduleError } = await supabase
          .from('schedules')
          .insert({ ...payload, created_by: session.user.id })
          .select('id')
          .single();

        if (scheduleError) throw scheduleError;
        scheduleId = schedule.id;
      }

      // Batch insert topics
      const validTopics = topics.filter(t => t.name.trim());
      if (validTopics.length > 0) {
        const { error: topicsError } = await supabase
          .from('schedule_topics')
          .insert(validTopics.map((t, idx) => ({
            schedule_id: scheduleId,
            name:        t.name.trim(),
            description: t.description.trim() || null,
            order_index: idx,
          })));
        if (topicsError) throw topicsError;
      }

      // Batch insert resources
      const validResources = resources.filter(r => r.name.trim() && r.url.trim());
      if (validResources.length > 0) {
        const { error: resourcesError } = await supabase
          .from('schedule_resources')
          .insert(validResources.map(r => ({
            schedule_id: scheduleId,
            name:        r.name.trim(),
            url:         r.url.trim(),
          })));
        if (resourcesError) throw resourcesError;
      }

      router.push('/dashboard#schedule');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // -- Render ---
  const P = palette(C);
  const field = inputStyle(C);
  const onPanel = { ...field, background: C.card };
  const binStyle = { background: P.badSoft, color: P.bad };

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <EditorHeader C={C} back="All schedules" onBack={() => router.push('/dashboard#schedule')}
          title={title.trim() || (editId ? 'Edit schedule' : 'New schedule')}
          pill={savedStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
          error={error} onDismissError={() => setError('')}
          actions={<>
            <button type="button" onClick={() => save('draft')} disabled={loading} className={btnClass} style={btnStyle('sec', C)}>
              <Check className="w-4 h-4" /> Save draft
            </button>
            <button type="button" onClick={() => save('published')} disabled={loading} className={btnClass} style={btnStyle('pri', C)}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} {savedStatus === 'published' ? 'Publish changes' : 'Publish'}
            </button>
          </>} />

        <Card C={C} className="mt-4">
          <Sect C={C} title="About the schedule" first>
            <div>
              <Label C={C}>Title</Label>
              <input type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                placeholder="For example Data Science Bootcamp: Week 1" className={FIELD} style={field} maxLength={255} />
            </div>
            <div>
              <Label C={C}>Course</Label>
              <MenuSelect field label="Course" value={courseId} C={C} placeholder="None"
                options={[{ value: '', label: 'None' }, ...courses.map(c => ({ value: c.id, label: c.title }))]} onChange={setCourseId} />
            </div>
            <div>
              <Label C={C}>Description</Label>
              <RichTextEditor value={description} onChange={setDescription} placeholder="Briefly describe what this schedule covers" enableAiAssist />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label C={C}>Start date</Label>
                <DateField label="Start date" value={startDate} onChange={setStartDate} C={C} />
              </div>
              <div>
                <Label C={C}>End date</Label>
                <DateField label="End date" value={endDate} onChange={setEndDate} C={C} />
              </div>
            </div>
          </Sect>

          <Sect C={C} title="Cover">
            <CoverField C={C} value={coverImage} onChange={setCoverImage} />
          </Sect>

          <Sect C={C} title="Topics" aside={`${topics.length} topic${topics.length === 1 ? '' : 's'}`}>
            <p className="text-xs" style={{ color: C.muted }}>Topics are ordered by their position in the list.</p>
            {topics.length > 0 && (
              <div className="grid gap-2">
                {topics.map((topic, idx) => (
                  <div key={topic.id} className="rounded-xl p-3 grid gap-2" style={{ background: C.page }}>
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{idx + 1}</span>
                      <input type="text" placeholder="Topic name" value={topic.name} aria-label={`Topic ${idx + 1} name`}
                        onChange={e => updateTopic(topic.id, 'name', sanitizePlainText(e.target.value))}
                        className={`${FIELD} flex-1 min-w-0`} style={onPanel} maxLength={200} />
                      <button type="button" onClick={() => removeTopic(topic.id)} aria-label={`Remove topic ${idx + 1}`}
                        className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={binStyle}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <textarea placeholder="Topic description (optional)" value={topic.description} aria-label={`Topic ${idx + 1} description`}
                      onChange={e => updateTopic(topic.id, 'description', sanitizePlainText(e.target.value))}
                      className={`${FIELD} resize-y`} style={{ ...onPanel, minHeight: 64 }} />
                  </div>
                ))}
              </div>
            )}
            <div><button type="button" onClick={addTopic} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add topic</button></div>
          </Sect>

          <Sect C={C} title="Resources" aside={`${resources.length} resource${resources.length === 1 ? '' : 's'}`}>
            {resources.length > 0 && (
              <div className="grid gap-2">
                {resources.map((resource, idx) => (
                  <div key={resource.id} className="rounded-xl p-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center" style={{ background: C.page }}>
                    <input type="text" placeholder="Resource name" value={resource.name} aria-label={`Resource ${idx + 1} name`}
                      onChange={e => updateResource(resource.id, 'name', sanitizePlainText(e.target.value))}
                      className={FIELD} style={onPanel} maxLength={200} />
                    <input type="url" placeholder="https://" value={resource.url} aria-label={`Resource ${idx + 1} link`}
                      onChange={e => updateResource(resource.id, 'url', e.target.value)}
                      className={FIELD} style={onPanel} />
                    <button type="button" onClick={() => removeResource(resource.id)} aria-label={`Remove resource ${idx + 1}`}
                      className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={binStyle}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div><button type="button" onClick={addResource} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add resource</button></div>
          </Sect>

          {cohorts.length > 0 && (
            <Sect C={C} title="Cohorts" aside={`${selectedCohortIds.length} selected`}>
              <TickList C={C} items={cohorts} selected={selectedCohortIds} onToggle={toggleCohort} />
            </Sect>
          )}
        </Card>
      </div>
    </div>
  );
}
