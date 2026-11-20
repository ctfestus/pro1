'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Copy, Database, Download, Edit2, Eye, FileCode, FileText, GripVertical, Loader2, Plus, Sparkles, Trash2, Upload, Video, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { safeEmbedUrl, isHtmlEmbedUrl, HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';
import { downloadJSON } from '@/lib/dashboard-export';
import { PexelsImagePicker } from '@/components/PexelsImagePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LIGHT_C, DARK_C, type ThemeColors } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, Kpis, PageHeader, StatusChips, matchesFilters, type Status } from '@/components/dashboard/content/kit';
import { BUTTON, FIELD, Modal, inputStyle as fieldStyle } from '@/components/dashboard/subscriptions/Modal';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';

function WhatsAppIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

type DatasetFile = { name: string; url: string };
type DatasetQuestionType = 'sql' | 'analytics';
type AnalystTask = { id?: string; prompt: string; description?: string; type?: DatasetQuestionType };
type AnalystSection = { id?: string; title: string; brief?: string; videoUrl?: string; difficulty?: string; duration?: string; tasks: AnalystTask[] };

type DatasetRow = {
  id: string; title: string; description: string | null; cover_image_url: string | null;
  cover_image_alt: string | null; tags: string[]; category: string | null;
  sample_questions: string[]; sample_question_types?: DatasetQuestionType[] | null; analyst_sections?: AnalystSection[] | null; file_url: string | null; file_name: string | null;
  files: DatasetFile[];
  row_count: number | null; source: string | null; source_url: string | null;
  scenario: string | null; disclaimer: string | null;
  table_type: 'single' | 'multiple' | null;
  sql_workbench_enabled: boolean;
  is_published: boolean; created_at: string;
};

const BLANK_DATASET: Omit<DatasetRow, 'id' | 'created_at'> = {
  title: '', description: '', cover_image_url: null, cover_image_alt: null,
  tags: [], category: '', sample_questions: [], sample_question_types: [], analyst_sections: [], file_url: '', file_name: '',
  files: [],
  row_count: null, source: null, source_url: null, scenario: null, disclaimer: null, table_type: null, sql_workbench_enabled: true, is_published: false,
};

/** One titled block of the dataset editor's card; blocks after the first get a divider line. */
function Sect({ title, aside, action, first, children, C }: { title: string; aside?: string; action?: React.ReactNode; first?: boolean; children: React.ReactNode; C: ThemeColors }) {
  return (
    <div className="p-5 grid grid-cols-[minmax(0,1fr)] gap-4" style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold flex-1" style={{ color: C.text }}>{title}</h3>
        {aside && <span className="text-xs" style={{ color: C.muted }}>{aside}</span>}
        {action}
      </div>
      {children}
    </div>
  );
}

export function DataCenterAdminSection({ C }: { C: typeof LIGHT_C }) {
  const [datasets, setDatasets]   = useState<DatasetRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState<'list' | 'editor'>('list');
  const [editorTab, setEditorTab] = useState<'overview' | 'dataset' | 'phases' | 'disclaimer'>('overview');
  const [editing, setEditing]     = useState<DatasetRow | null>(null);
  const [form, setForm]           = useState({ ...BLANK_DATASET });
  const [saving, setSaving]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [error, setError]         = useState('');
  const [tagInput, setTagInput]   = useState('');
  const [fileMode, setFileMode]         = useState<'link' | 'upload'>('link');
  const [fileUploading, setFileUploading] = useState(false);
  const dataFileRef               = useRef<HTMLInputElement>(null);
  const [expandedAnalystSections, setExpandedAnalystSections] = useState<Record<string, boolean>>({});
  // Drag-and-drop reordering for analysis phases and their tasks.
  const [dragState, setDragState] = useState<{ kind: 'section' | 'task'; sectionId: string; id: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Community WhatsApp link (stored in platform_settings, shown as a banner on the Data Playground).
  const [waOpen, setWaOpen]     = useState(false);
  const [waLink, setWaLink]     = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waMsg, setWaMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  // The list: filters, the dataset asked to be deleted, and the list's own blue for selection controls.
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState<Status>('all');
  const [confirmDelete, setConfirmDelete] = useState<DatasetRow | null>(null);
  const LC = useMemo(() => ({ ...C, cta: DARK_C.cta }), [C]);

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  }

  async function openWhatsApp() {
    setWaMsg(null);
    setWaOpen(true);
    setWaLoading(true);
    try {
      const res = await fetch('/api/platform-settings');
      if (res.ok) {
        const { data } = await res.json();
        setWaLink(data?.whatsapp_community_url ?? '');
      }
    } catch {}
    setWaLoading(false);
  }

  async function saveWhatsApp() {
    setWaSaving(true);
    setWaMsg(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/platform-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ whatsappCommunityUrl: waLink }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setWaMsg({ ok: true, text: 'Saved. The banner updates on the Data Playground within 60 seconds.' });
      setTimeout(() => setWaOpen(false), 1400);
    } catch (e: any) {
      setWaMsg({ ok: false, text: e.message });
    } finally {
      setWaSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    const token = await getToken();
    const res = await fetch('/api/data-center', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    setDatasets(json.datasets ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...BLANK_DATASET });
    setTagInput('');
    setExpandedAnalystSections({});
    setError('');
    setEditorTab('overview');
    setView('editor');
  }

  function openEdit(d: DatasetRow) {
    const files = normalizeDatasetFiles(d);
    setEditing(d);
    setForm({
      title: d.title, description: d.description ?? '', cover_image_url: d.cover_image_url,
      cover_image_alt: d.cover_image_alt, tags: d.tags, category: d.category ?? '',
      sample_questions: d.sample_questions, sample_question_types: normalizeQuestionTypes(d.sample_questions, d.sample_question_types), file_url: d.file_url ?? '',
      analyst_sections: normalizeAnalystSections(d.analyst_sections, d.sample_questions, d.sample_question_types),
      file_name: d.file_name ?? '', row_count: d.row_count,
      files,
      source: d.source ?? '', source_url: d.source_url ?? '', scenario: d.scenario ?? '', disclaimer: d.disclaimer ?? '',
      table_type: d.table_type ?? null,
      sql_workbench_enabled: d.sql_workbench_enabled ?? true,
      is_published: d.is_published,
    });
    setTagInput('');
    setExpandedAnalystSections({});
    setError('');
    setEditorTab('overview');
    setView('editor');
  }


  function normalizeQuestionTypes(questions: string[] = [], types?: (DatasetQuestionType | string)[] | null): DatasetQuestionType[] {
    return questions.map((_, i) => types?.[i] === 'sql' ? 'sql' : 'analytics');
  }

  function newAnalystId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function normalizeAnalystSections(sections?: AnalystSection[] | null, questions: string[] = [], types?: (DatasetQuestionType | string)[] | null): AnalystSection[] {
    const cleaned = (Array.isArray(sections) ? sections : [])
      .map((section, sectionIndex) => {
        const tasks = (Array.isArray(section.tasks) ? section.tasks : [])
          .map((task, taskIndex) => ({
            id: task.id || `task-${sectionIndex + 1}-${taskIndex + 1}`,
            // Do NOT trim here: this runs on every keystroke while editing, and trimming
            // would strip spaces as you type. Final trimming happens in compactAnalystSections (on save).
            prompt: String(task.prompt ?? ''),
            description: String(task.description ?? ''),
            type: task.type === 'sql' ? 'sql' as const : 'analytics' as const,
          }));
        return {
          id: section.id || `section-${sectionIndex + 1}`,
          title: String(section.title ?? '') || `Analysis Phase ${sectionIndex + 1}`,
          brief: String(section.brief ?? ''),
          videoUrl: String(section.videoUrl ?? ''),
          difficulty: String(section.difficulty ?? ''),
          duration: String(section.duration ?? ''),
          tasks,
        };
      });

    if (cleaned.length > 0) return cleaned;

    const qTypes = normalizeQuestionTypes(questions, types);
    const sqlTasks = questions
      .map((prompt, i) => ({ prompt: prompt.trim(), type: qTypes[i], id: `legacy-task-${i + 1}` }))
      .filter(task => task.prompt && task.type === 'sql');
    const analyticsTasks = questions
      .map((prompt, i) => ({ prompt: prompt.trim(), type: qTypes[i], id: `legacy-task-${i + 1}` }))
      .filter(task => task.prompt && task.type === 'analytics');

    return [
      sqlTasks.length ? { id: 'legacy-sql-practice', title: 'SQL Practice', brief: 'Tasks students should answer directly in the SQL Workbench.', tasks: sqlTasks } : null,
      analyticsTasks.length ? { id: 'legacy-analytics', title: 'Analytics Questions', brief: 'Broader analysis and business interpretation tasks.', tasks: analyticsTasks } : null,
    ].filter(Boolean) as AnalystSection[];
  }

  function flattenAnalystQuestions(sections: AnalystSection[]) {
    const tasks = sections.flatMap(section => section.tasks).filter(task => task.prompt.trim());
    return {
      sample_questions: tasks.map(task => task.prompt),
      sample_question_types: tasks.map(task => task.type === 'sql' ? 'sql' as const : 'analytics' as const),
    };
  }

  function compactAnalystSections(sections: AnalystSection[]) {
    return sections
      .map(section => ({
        ...section,
        title: section.title.trim(),
        brief: section.brief?.trim() ?? '',
        videoUrl: section.videoUrl?.trim() ?? '',
        difficulty: section.difficulty?.trim() ?? '',
        duration: section.duration?.trim() ?? '',
        tasks: section.tasks
          .map(task => ({ ...task, prompt: task.prompt.trim(), description: task.description?.trim() ?? '', type: task.type === 'sql' ? 'sql' as const : 'analytics' as const }))
          .filter(task => task.prompt),
      }))
      .filter(section => section.title || section.tasks.length > 0);
  }

  function normalizeDatasetFiles(d: { file_url?: string | null; file_name?: string | null; files?: DatasetFile[] | null }) {
    const seen = new Set<string>();
    const files: DatasetFile[] = [];
    const add = (name: string | null | undefined, url: string | null | undefined) => {
      const cleanUrl = url?.trim();
      if (!cleanUrl || seen.has(cleanUrl)) return;
      seen.add(cleanUrl);
      files.push({ name: name?.trim() || cleanUrl.split('/').pop() || 'Dataset file', url: cleanUrl });
    };
    add(d.file_name, d.file_url);
    (d.files ?? []).forEach(file => add(file.name, file.url));
    return files;
  }

  function setPrimaryFile(file: DatasetFile | null) {
    setForm(f => ({ ...f, file_url: file?.url ?? '', file_name: file?.name ?? '' }));
  }

  function unlinkDatasetFile(url: string) {
    setForm(f => {
      const files = normalizeDatasetFiles(f).filter(file => file.url !== url);
      const currentPrimaryRemoved = f.file_url === url;
      const nextPrimary = currentPrimaryRemoved ? files[0] : files.find(file => file.url === f.file_url) ?? files[0];
      return {
        ...f,
        files,
        file_url: nextPrimary?.url ?? '',
        file_name: nextPrimary?.name ?? '',
      };
    });
  }

  async function removeDatasetFile(url: string) {
    setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/data-center/github-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Could not delete file from storage.');
        return;
      }
      unlinkDatasetFile(url);
    } catch {
      setError('Could not delete file from storage.');
    }
  }

  async function generateMetadata() {
    if (!form.file_url) { setError('Upload or paste a file URL first before generating metadata.'); return; }
    setGenerating(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/data-center/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file_url: form.file_url, file_name: form.file_name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Generation failed'); return; }
      const generatedSections = normalizeAnalystSections(data.analyst_sections, data.sample_questions, data.sample_question_types);
      setForm(f => {
        const flattened = generatedSections.length
          ? flattenAnalystQuestions(generatedSections)
          : {
              sample_questions: data.sample_questions?.length ? data.sample_questions : f.sample_questions,
              sample_question_types: data.sample_questions?.length ? data.sample_questions.map(() => 'analytics' as const) : f.sample_question_types,
            };
        return {
          ...f,
          title:            data.title            ?? f.title,
          description:      data.description      ?? f.description,
          scenario:         data.scenario         ?? f.scenario,
          category:         data.category         ?? f.category,
          tags:             data.tags?.length      ? data.tags : f.tags,
          analyst_sections: generatedSections.length ? generatedSections : f.analyst_sections,
          sample_questions: flattened.sample_questions,
          sample_question_types: flattened.sample_question_types,
        };
      });
    } catch {
      setError('AI generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function save(publish?: boolean) {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    const token = await getToken();
    // Commit any partially typed tag before saving
    const pendingTag = tagInput.trim();
    const allTags = pendingTag && !form.tags.includes(pendingTag) ? [...form.tags, pendingTag] : form.tags;
    const files = normalizeDatasetFiles(form);
    const primary = files.find(file => file.url === form.file_url) ?? files[0];
    const analyst_sections = compactAnalystSections(normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types));
    const flattenedQuestions = flattenAnalystQuestions(analyst_sections);
    const isPublished = publish === undefined ? form.is_published : publish;
    const payload = {
      ...form,
      is_published: isPublished,
      tags: allTags,
      analyst_sections,
      sample_questions: flattenedQuestions.sample_questions,
      sample_question_types: flattenedQuestions.sample_question_types,
      files,
      file_url: primary?.url ?? '',
      file_name: primary?.name ?? '',
      ...(editing ? { id: editing.id } : {}),
    };
    const res = await fetch('/api/data-center', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Save failed'); setSaving(false); return; }
    await load();
    setView('list');
    setSaving(false);
  }

  async function deleteDataset(id: string) {
    const token = await getToken();
    await fetch(`/api/data-center?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    await load();
  }

  async function togglePublish(d: DatasetRow) {
    const token = await getToken();
    await fetch('/api/data-center', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: d.id, is_published: !d.is_published }),
    });
    await load();
  }

  function datasetPayload(d: DatasetRow | typeof BLANK_DATASET) {
    const analyst_sections = compactAnalystSections(normalizeAnalystSections(d.analyst_sections, d.sample_questions, d.sample_question_types));
    const flattenedQuestions = flattenAnalystQuestions(analyst_sections);
    return {
      title: d.title, description: d.description, cover_image_url: d.cover_image_url,
      cover_image_alt: d.cover_image_alt, tags: d.tags, category: d.category,
      sample_questions: flattenedQuestions.sample_questions, sample_question_types: flattenedQuestions.sample_question_types, analyst_sections, file_url: d.file_url, file_name: d.file_name,
      files: normalizeDatasetFiles(d),
      source: d.source, source_url: (d as any).source_url ?? null, scenario: (d as any).scenario ?? null, disclaimer: d.disclaimer,
      table_type: d.table_type, sql_workbench_enabled: d.sql_workbench_enabled, is_published: d.is_published,
    };
  }

  function exportDataset(d: DatasetRow) {
    downloadJSON({ exportVersion: 1, type: 'dataset', exportedAt: new Date().toISOString(), data: datasetPayload(d) }, d.title);
  }

  function exportAllDatasets() {
    const items = datasets.map(d => ({ exportVersion: 1, type: 'dataset', exportedAt: new Date().toISOString(), data: datasetPayload(d) }));
    downloadJSON({ exportVersion: 1, bulkExport: true, type: 'dataset', exportedAt: new Date().toISOString(), items }, 'all_datasets');
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload.exportVersion !== 1) throw new Error('Unrecognised export file.');
      const token = await getToken();
      const items: any[] = payload.bulkExport ? (payload.items ?? []) : [payload];
      const invalid = items.find(it => it.type !== 'dataset');
      if (invalid) throw new Error(`File contains "${invalid.type}" items, expected dataset.`);
      let created = 0; let failed = 0; let lastError = '';
      for (const item of items) {
        const res = await fetch('/api/data-center', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(item.data),
        });
        if (res.ok) {
          created++;
        } else {
          failed++;
          const j = await res.json().catch(() => ({}));
          lastError = j.error ?? `HTTP ${res.status}`;
        }
      }
      await load();
      if (failed === 0) {
        setImportMsg({ ok: true, text: `${created} dataset${created !== 1 ? 's' : ''} imported` });
      } else {
        setImportMsg({ ok: false, text: `${created} imported, ${failed} failed${lastError ? ': ' + lastError : ''}` });
      }
      setTimeout(() => setImportMsg(null), 4000);
    } catch (err: any) {
      setImportMsg({ ok: false, text: err.message || 'Import failed.' });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function uploadBlob(blob: Blob, fileName: string): Promise<DatasetFile | null> {
    const token = await getToken();
    const fd = new FormData();
    fd.append('file', new File([blob], fileName, { type: blob.type || 'application/octet-stream' }));
    const res = await fetch('/api/data-center/github-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Upload failed'); return null; }
    const record = { name: json.name ?? fileName, url: json.url };
    setForm(f => {
      const files = normalizeDatasetFiles({ ...f, files: [...normalizeDatasetFiles(f), record] });
      const primary = f.file_url ? files.find(file => file.url === f.file_url) : record;
      return { ...f, files, file_url: primary?.url ?? '', file_name: primary?.name ?? '' };
    });
    return record;
  }

  async function handleDataFileUpload(file: File) {
    setError('');
    setFileUploading(true);
    try {
      await uploadBlob(file, file.name);
    } catch {
      setError('File upload failed.');
    } finally {
      setFileUploading(false);
      if (dataFileRef.current) dataFileRef.current.value = '';
    }
  }

  async function handleDataFilesUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    for (const file of list) {
      await handleDataFileUpload(file);
    }
  }

  function syncAnalystSections(sections: AnalystSection[]) {
    const cleaned = normalizeAnalystSections(sections);
    const flattened = flattenAnalystQuestions(cleaned);
    setForm(f => ({
      ...f,
      analyst_sections: cleaned,
      sample_questions: flattened.sample_questions,
      sample_question_types: flattened.sample_question_types,
    }));
  }

  function addAnalystSection() {
    const section: AnalystSection = {
      id: newAnalystId('section'),
      title: 'New Analysis Phase',
      brief: '',
      tasks: [{ id: newAnalystId('task'), prompt: '', type: 'analytics' }],
    };
    setForm(f => ({ ...f, analyst_sections: [...normalizeAnalystSections(f.analyst_sections, f.sample_questions, f.sample_question_types), section] }));
    setExpandedAnalystSections(prev => ({ ...prev, [section.id!]: true }));
  }

  function updateAnalystSection(sectionId: string, updates: Partial<AnalystSection>) {
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types)
      .map(section => section.id === sectionId ? { ...section, ...updates } : section);
    syncAnalystSections(sections);
  }

  function removeAnalystSection(sectionId: string) {
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types)
      .filter(section => section.id !== sectionId);
    syncAnalystSections(sections);
  }

  function addAnalystTask(sectionId: string, type: DatasetQuestionType = 'analytics') {
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types)
      .map(section => section.id === sectionId
        ? { ...section, tasks: [...section.tasks, { id: newAnalystId('task'), prompt: '', type }] }
        : section);
    syncAnalystSections(sections);
  }

  function updateAnalystTask(sectionId: string, taskId: string, updates: Partial<AnalystTask>) {
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types)
      .map(section => section.id === sectionId
        ? { ...section, tasks: section.tasks.map(task => task.id === taskId ? { ...task, ...updates } : task) }
        : section);
    syncAnalystSections(sections);
  }

  function removeAnalystTask(sectionId: string, taskId: string) {
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types)
      .map(section => section.id === sectionId
        ? { ...section, tasks: section.tasks.filter(task => task.id !== taskId) }
        : section);
    syncAnalystSections(sections);
  }

  function reorderArray<T>(arr: T[], from: number, to: number): T[] {
    if (from === -1 || to === -1 || from === to) return arr;
    const next = [...arr];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  function reorderAnalystSections(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types);
    syncAnalystSections(reorderArray(sections, sections.findIndex(s => s.id === draggedId), sections.findIndex(s => s.id === targetId)));
  }

  function reorderAnalystTasks(sectionId: string, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const sections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types)
      .map(section => section.id === sectionId
        ? { ...section, tasks: reorderArray(section.tasks, section.tasks.findIndex(t => t.id === draggedId), section.tasks.findIndex(t => t.id === targetId)) }
        : section);
    syncAnalystSections(sections);
  }

  if (view === 'editor') {
    // The admin editor style: the dark-mode blue for buttons and selection controls, fields from the shared kit.
    const EC = LC;
    const P = palette(EC);
    const TABS = [['overview', 'Overview'], ['dataset', 'Dataset'], ['phases', 'Analysis phases'], ['disclaimer', 'Disclaimer']] as const;
    const analystSections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types);
    const files = normalizeDatasetFiles(form);
    const taskCount = analystSections.reduce((n, s) => n + s.tasks.length, 0);
    const field = fieldStyle(EC);
    // Fields inside a grey phase block take the card colour, so they do not vanish into it.
    const onGrey = { ...field, background: EC.card };
    const label = 'text-xs font-semibold mb-2 block';
    const iconBtn = 'w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0 transition-opacity hover:opacity-80 disabled:opacity-30';
    const chip = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { color: EC.muted });
    const CATEGORIES = ['Finance', 'Human Resources', 'Fintech', 'E-Commerce', 'Marketing', 'Health Care', 'Hospitality', 'Sport', 'Retail', 'Banking', 'Telecom', 'Other'];
    const isOtherCategory = !!form.category && !CATEGORIES.slice(0, -1).includes(form.category);
    const categoryValue = isOtherCategory ? 'Other' : (form.category ?? '');
    const note = (tone: 'good' | 'warn', children: React.ReactNode) => (
      <div className="mt-2 px-3.5 py-2.5 rounded-xl text-[12.5px] leading-relaxed" style={tone === 'good'
        ? { background: EC.successBg, color: EC.successText, border: `1px solid ${EC.successBorder}` }
        : { background: P.warnSoft, color: P.warn }}>{children}</div>
    );

    return (
      <div className="pb-12">
        <button type="button" onClick={() => setView('list')} className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 hover:opacity-80" style={{ color: EC.muted }}>
          <ArrowLeft className="w-4 h-4"/>All datasets
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: EC.text, fontFamily: DISPLAY_FONT }}>{form.title.trim() || 'New dataset'}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm" style={{ color: EC.muted }}>
              {editing?.is_published ? <Pill tone="good" dot C={EC}>Published</Pill> : <Pill tone="warn" C={EC}>Draft</Pill>}
              <span>{plural(files.length, 'file')}</span>
              {form.row_count != null && <span>{plural(form.row_count, 'row')}</span>}
              <span>{plural(analystSections.length, 'phase')}, {plural(taskCount, 'task')}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={generateMetadata} disabled={generating || !form.file_url} className={btnClass} style={btnStyle('sec', EC)}
              title={!form.file_url ? 'Add a file link or upload a file first' : 'Fill the title, description, tags, category and tasks with AI'}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
              {generating ? 'Filling...' : 'Fill with AI'}
            </button>
            {editing && (
              <a href="/data-playground" target="_blank" rel="noreferrer" className={`${btnClass} no-underline`} style={btnStyle('sec', EC)}>
                <Eye className="w-4 h-4"/>Preview
              </a>
            )}
            <button type="button" onClick={() => save(false)} disabled={saving} className={btnClass} style={btnStyle('sec', EC)}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}Save draft
            </button>
            <button type="button" onClick={() => save(true)} disabled={saving} className={btnClass} style={btnStyle('pri', EC)}>
              {editing?.is_published ? 'Publish changes' : 'Publish'}
            </button>
          </div>
        </div>
        <div role="tablist" aria-label="Dataset sections" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: EC.card }}>
          {TABS.map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={editorTab === id} onClick={() => setEditorTab(id)}
              className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
              style={editorTab === id ? { background: P.sel, color: P.onSel } : { color: EC.muted }}>{name}</button>
          ))}
        </div>
        {error && (
          <div role="alert" className="mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: EC.errorBg, color: EC.errorText, border: `1px solid ${EC.errorBorder}` }}>
            <XCircle className="w-4 h-4 flex-shrink-0"/><span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4"/></button>
          </div>
        )}

        <Card C={EC} className="mt-4 overflow-hidden">
          {editorTab === 'overview' && (<>
            <Sect C={EC} title="About the dataset" first>
              <div>
                <label htmlFor="ds-title" className={label} style={{ color: EC.muted }}>Title</label>
                <input id="ds-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="For example, West Africa Retail Sales 2020-2023" className={FIELD} style={field}/>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className={label} style={{ color: EC.muted }}>Category</span>
                  <MenuSelect label="Category" field value={categoryValue} placeholder="Select category" C={EC}
                    options={CATEGORIES.map(c => ({ value: c, label: c }))}
                    onChange={v => setForm(f => ({ ...f, category: v === 'Other' ? '' : v }))}/>
                  {categoryValue === 'Other' && (
                    <input autoFocus value={isOtherCategory ? form.category ?? '' : ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      placeholder="Name the category" aria-label="Category name" className={`${FIELD} mt-2`} style={field}/>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="ds-desc" className={label} style={{ color: EC.muted }}>Description</label>
                <textarea id="ds-desc" value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4}
                  placeholder="The dataset, its source, and what learners can learn from it." className={`${FIELD} resize-y`} style={field}/>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ds-source" className={label} style={{ color: EC.muted }}>Source</label>
                  <input id="ds-source" value={form.source ?? ''} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="For example, World Bank or Kaggle" className={FIELD} style={field}/>
                </div>
                <div>
                  <label htmlFor="ds-source-url" className={label} style={{ color: EC.muted }}>Source URL</label>
                  <input id="ds-source-url" value={form.source_url ?? ''} onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))} placeholder="https://data.worldbank.org/" className={FIELD} style={field}/>
                  <p className="text-xs mt-2" style={{ color: EC.muted }}>Optional</p>
                </div>
              </div>
            </Sect>
            <Sect C={EC} title="Cover image">
              <PexelsImagePicker
                value={form.cover_image_url}
                altValue={form.cover_image_alt}
                onChange={(url, alt) => setForm(f => ({ ...f, cover_image_url: url, cover_image_alt: alt }))}
                onClear={() => setForm(f => ({ ...f, cover_image_url: null, cover_image_alt: null }))}
                C={EC}
                token=""
                previewMaxWidth={360}
              />
            </Sect>
          </>)}

          {editorTab === 'dataset' && (<>
            <Sect C={EC} title="Files" first>
              <div className="inline-flex gap-1 p-1 rounded-xl w-fit" style={{ background: EC.page }} role="group" aria-label="How to add the file">
                {(['link', 'upload'] as const).map(mode => (
                  <button key={mode} type="button" aria-pressed={fileMode === mode} onClick={() => setFileMode(mode)}
                    className="h-8 px-3.5 rounded-[9px] text-[13px] font-semibold" style={chip(fileMode === mode)}>
                    {mode === 'link' ? 'Paste a link' : 'Upload files'}
                  </button>
                ))}
              </div>
              {fileMode === 'link' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ds-file-url" className={label} style={{ color: EC.muted }}>File link</label>
                    <input id="ds-file-url" value={form.file_url ?? ''} placeholder="https://" className={FIELD} style={field}
                      onChange={e => {
                        let url = e.target.value;
                        // GitHub file pages become raw links, so the file itself is fetched.
                        if (/github\.com\/.+\/blob\//i.test(url)) url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                        setForm(f => ({ ...f, file_url: url }));
                      }}/>
                  </div>
                  <div>
                    <label htmlFor="ds-file-name" className={label} style={{ color: EC.muted }}>File name</label>
                    <input id="ds-file-name" value={form.file_name ?? ''} onChange={e => setForm(f => ({ ...f, file_name: e.target.value }))} placeholder="sales_data.csv" className={FIELD} style={field}/>
                  </div>
                  <div className="sm:col-span-2">
                    {/github\.com|raw\.githubusercontent\.com/i.test(form.file_url ?? '') && note('good', <>
                      <strong>GitHub link.</strong> {/raw\.githubusercontent\.com/i.test(form.file_url ?? '') ? 'It is a raw link, so the file can be read directly.' : 'Changed to a raw link so the file can be read directly.'}
                    </>)}
                    {/box\.com/i.test(form.file_url ?? '') && note('warn', <>
                      <strong>Box link.</strong> Box direct downloads need a paid plan, so a standard Box shared link cannot be read.<br/>
                      Free options that work: a public GitHub repo (the link is changed to a raw link here); Google Drive shared publicly, with <code>/file/d/ID/view</code> changed to <code>/uc?export=download&id=ID</code>; Dropbox with <code>?dl=0</code> changed to <code>?dl=1</code>; or upload the file directly.
                    </>)}
                  </div>
                </div>
              )}
              {fileMode === 'upload' && (
                <div
                  role="button" tabIndex={0}
                  onClick={() => !fileUploading && dataFileRef.current?.click()}
                  onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !fileUploading) { e.preventDefault(); dataFileRef.current?.click(); } }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = EC.cta; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = EC.divider; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = EC.divider; if (e.dataTransfer.files.length) handleDataFilesUpload(e.dataTransfer.files); }}
                  className="rounded-xl px-5 py-6 text-center cursor-pointer" style={{ border: `2px dashed ${EC.divider}`, color: EC.muted }}>
                  {fileUploading
                    ? <><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2"/><p className="text-sm">Uploading...</p></>
                    : <>
                        <Upload className="w-6 h-6 mx-auto mb-2"/>
                        <p className="text-sm font-semibold" style={{ color: EC.text }}>Click to upload or drag files here</p>
                        <p className="text-xs mt-1">CSV, Excel, JSON, ZIP or PDF, up to 50 MB</p>
                      </>}
                  <input ref={dataFileRef} type="file" multiple accept=".csv,.xlsx,.json,.zip,.pdf" className="hidden" onChange={e => { if (e.target.files?.length) handleDataFilesUpload(e.target.files); }}/>
                </div>
              )}
              {files.length > 0 && (
                <div>
                  {files.map((file, i) => {
                    const isPrimary = file.url === form.file_url;
                    return (
                      <div key={file.url} className="flex items-center gap-3 py-2.5 px-0.5" style={i ? { borderTop: `1px solid ${EC.divider}` } : undefined}>
                        <FileText className="w-4 h-4 flex-shrink-0" style={{ color: EC.muted }}/>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: EC.text }}>{file.name}</span>
                        {isPrimary
                          ? <Pill tone="mute" C={EC}>Primary</Pill>
                          : <button type="button" onClick={() => setPrimaryFile(file)} className={btnSmClass} style={btnStyle('ghost', EC)}>Make primary</button>}
                        <button type="button" onClick={() => navigator.clipboard.writeText(file.url)} aria-label={`Copy link to ${file.name}`} className={iconBtn} style={{ color: EC.muted }}><Copy className="w-4 h-4"/></button>
                        <button type="button" onClick={() => removeDatasetFile(file.url)} aria-label={`Remove ${file.name}`} className={iconBtn} style={{ color: EC.muted }}><X className="w-4 h-4"/></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Sect>
            <Sect C={EC} title="Tables">
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tables">
                {([['single', 'Single table', 'One CSV or sheet'], ['multiple', 'Multiple tables', 'A ZIP or workbook with related tables']] as const).map(([opt, name, sub]) => {
                  const on = form.table_type === opt;
                  return (
                    <button key={opt} type="button" role="radio" aria-checked={on} onClick={() => setForm(f => ({ ...f, table_type: f.table_type === opt ? null : opt }))}
                      className="flex items-start gap-3 p-4 rounded-2xl text-left" style={{ background: EC.page, boxShadow: on ? `inset 0 0 0 2px ${P.sel}` : 'none' }}>
                      <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={on ? { background: P.sel } : { background: EC.card, boxShadow: `inset 0 0 0 1px ${EC.divider}` }}>
                        {on && <span className="w-2 h-2 rounded-full" style={{ background: P.onSel }}/>}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: EC.text }}>{name}</span>
                        <span className="block text-xs" style={{ color: EC.muted }}>{sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Sect>
            <div className="p-5 flex items-center gap-4" style={{ borderTop: `1px solid ${EC.divider}` }}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold" style={{ color: EC.text }}>SQL workbench</p>
                <p className="text-xs" style={{ color: EC.muted }}>Learners can practise SQL on this data in the browser (CSV, Excel or ZIP tables).</p>
              </div>
              <Switch on={form.sql_workbench_enabled} onChange={on => setForm(f => ({ ...f, sql_workbench_enabled: on }))} label="SQL workbench" C={EC}/>
            </div>
          </>)}

          {editorTab === 'phases' && (
            <Sect C={EC} title="Analysis phases" first>
              <p className="text-xs -mt-2" style={{ color: EC.muted }}>Break the dataset into phases, each with its own tasks. Mark a task SQL only if a SELECT or WITH query can answer it.</p>
              {analystSections.length === 0 && (
                <p className="px-3 py-5 rounded-xl text-[13px] text-center" style={{ border: `2px dashed ${EC.divider}`, color: EC.muted }}>No analysis phases yet. Add one to get started.</p>
              )}
              {analystSections.map((section, sectionIndex) => {
                const sectionId = section.id || `section-${sectionIndex + 1}`;
                const expanded = expandedAnalystSections[sectionId] !== false;
                const isDragging = dragState?.kind === 'section' && dragState.id === sectionId;
                const isDropTarget = dragState?.kind === 'section' && dragOverId === sectionId && dragState.id !== sectionId;
                const embedUrl = safeEmbedUrl(section.videoUrl ?? '');
                return (
                  <div key={sectionId} data-phasecard
                    onDragOver={e => { if (dragState?.kind === 'section') { e.preventDefault(); setDragOverId(sectionId); } }}
                    onDrop={e => { if (dragState?.kind === 'section') { e.preventDefault(); reorderAnalystSections(dragState.id, sectionId); } setDragOverId(null); }}
                    className="rounded-[14px]" style={{ background: EC.page, opacity: isDragging ? 0.45 : 1, outline: isDropTarget ? `2px solid ${P.sel}` : 'none', outlineOffset: -2 }}>
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 px-3 py-2.5">
                      <span draggable title="Drag to reorder phase" className="cursor-grab flex-shrink-0" style={{ color: EC.faint }}
                        onDragStart={e => { setDragState({ kind: 'section', sectionId, id: sectionId }); e.dataTransfer.effectAllowed = 'move'; const card = (e.currentTarget as HTMLElement).closest('[data-phasecard]'); if (card) e.dataTransfer.setDragImage(card, 20, 20); }}
                        onDragEnd={() => { setDragState(null); setDragOverId(null); }}>
                        <GripVertical className="w-4 h-4"/>
                      </span>
                      <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{sectionIndex + 1}</span>
                      <input value={section.title} onChange={e => updateAnalystSection(sectionId, { title: e.target.value })} aria-label="Phase title"
                        placeholder="Phase title, for example Channel and audience breakdown"
                        className="flex-1 min-w-0 basis-[calc(100%-84px)] sm:basis-auto bg-transparent outline-none text-[15px] font-semibold py-1" style={{ color: EC.text }}/>
                      <span className="text-xs flex-shrink-0 ml-auto sm:ml-0" style={{ color: EC.muted }}>{plural(section.tasks.length, 'task')}</span>
                      <button type="button" onClick={() => setExpandedAnalystSections(prev => ({ ...prev, [sectionId]: !expanded }))} aria-label={expanded ? 'Collapse phase' : 'Expand phase'} className={iconBtn} style={{ color: EC.muted }}>
                        {expanded ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                      </button>
                      <button type="button" onClick={() => removeAnalystSection(sectionId)} aria-label="Delete phase" className={iconBtn} style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4"/></button>
                    </div>
                    {expanded && (
                      <div className="px-3 pb-3 grid grid-cols-[minmax(0,1fr)] gap-2.5">
                        <RichTextEditor value={section.brief ?? ''} onChange={html => updateAnalystSection(sectionId, { brief: html })}
                          placeholder="Briefly describe what this phase asks the learner to investigate." bgOverride={EC.card} enableAiAssist/>
                        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="field-shell flex items-center gap-2 rounded-[10px] px-3" style={onGrey}>
                            <Video className="w-4 h-4 flex-shrink-0" style={{ color: EC.faint }}/>
                            <input value={section.videoUrl ?? ''} onChange={e => updateAnalystSection(sectionId, { videoUrl: e.target.value })} placeholder="Embed link (optional)" aria-label="Embed link"
                              className="flex-1 min-w-0 bg-transparent outline-none text-sm py-3" style={{ color: EC.text }}/>
                            {/* Interactive HTML embed: uploads to the public form-assets bucket; the player
                                renders it sandboxed at full height (same treatment as Canva) */}
                            <label title="Upload a self-contained HTML file with inline assets (max 10 MB)" className="cursor-pointer flex items-center flex-shrink-0">
                              <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={async e => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                e.target.value = '';
                                if (file.size > 10 * 1024 * 1024) { setError(`HTML file is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 10 MB.`); return; }
                                setError('');
                                try {
                                  const url = await uploadToStorage(file, 'lesson-html');
                                  updateAnalystSection(sectionId, { videoUrl: url });
                                } catch (err: any) { setError(err?.message || 'HTML upload failed. Please try again.'); }
                              }}/>
                              <FileCode className="w-4 h-4" style={{ color: EC.faint }}/>
                            </label>
                          </div>
                          <MenuSelect label="Difficulty" field value={section.difficulty ?? ''} onChange={v => updateAnalystSection(sectionId, { difficulty: v })} C={{ ...EC, input: EC.card }}
                            options={[{ value: '', label: 'Difficulty: Auto' }, { value: 'Beginner', label: 'Beginner' }, { value: 'Intermediate', label: 'Intermediate' }, { value: 'Advanced', label: 'Advanced' }]}/>
                          <input value={section.duration ?? ''} onChange={e => updateAnalystSection(sectionId, { duration: e.target.value })} placeholder="Duration: Auto" aria-label="Duration" className={FIELD} style={onGrey}/>
                        </div>
                        {embedUrl && (
                          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${EC.divider}` }}>
                            <iframe src={embedUrl} title="Phase embed"
                              style={{ width: '100%', border: 'none', display: 'block', ...(isHtmlEmbedUrl(embedUrl) ? { height: 480 } : { aspectRatio: '16 / 9' }) }}
                              sandbox={isHtmlEmbedUrl(embedUrl) ? HTML_EMBED_SANDBOX : undefined}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/>
                          </div>
                        )}
                        {section.tasks.map((task, taskIndex) => {
                          const taskId = task.id || `task-${sectionIndex + 1}-${taskIndex + 1}`;
                          const taskDragging = dragState?.kind === 'task' && dragState.id === taskId;
                          const taskDropTarget = dragState?.kind === 'task' && dragState.sectionId === sectionId && dragOverId === taskId && dragState.id !== taskId;
                          const type = task.type ?? 'analytics';
                          return (
                            <div key={taskId} data-taskcard
                              onDragOver={e => { if (dragState?.kind === 'task' && dragState.sectionId === sectionId) { e.preventDefault(); e.stopPropagation(); setDragOverId(taskId); } }}
                              onDrop={e => { if (dragState?.kind === 'task' && dragState.sectionId === sectionId) { e.preventDefault(); e.stopPropagation(); reorderAnalystTasks(sectionId, dragState.id, taskId); } setDragOverId(null); }}
                              className="flex flex-wrap sm:flex-nowrap items-start gap-2.5 rounded-xl px-3 py-2.5"
                              style={{ background: EC.card, opacity: taskDragging ? 0.45 : 1, outline: taskDropTarget ? `2px solid ${P.sel}` : 'none', outlineOffset: -2 }}>
                              <span draggable title="Drag to reorder task" className="cursor-grab flex-shrink-0 mt-1" style={{ color: EC.faint }}
                                onDragStart={e => { setDragState({ kind: 'task', sectionId, id: taskId }); e.dataTransfer.effectAllowed = 'move'; const card = (e.currentTarget as HTMLElement).closest('[data-taskcard]'); if (card) e.dataTransfer.setDragImage(card, 20, 20); }}
                                onDragEnd={() => { setDragState(null); setDragOverId(null); }}>
                                <GripVertical className="w-4 h-4"/>
                              </span>
                              <div className="min-w-0 flex-1 basis-[calc(100%-40px)] sm:basis-auto">
                                <textarea value={task.prompt} onChange={e => updateAnalystTask(sectionId, taskId, { prompt: e.target.value })} rows={1} aria-label="Task"
                                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                                  placeholder={type === 'sql' ? 'For example, which channel has the highest conversion rate?' : 'For example, what targeting should the team recommend?'}
                                  className="w-full bg-transparent outline-none resize-none overflow-hidden text-sm font-semibold leading-normal" style={{ color: EC.text }}/>
                                <textarea value={task.description ?? ''} onChange={e => updateAnalystTask(sectionId, taskId, { description: e.target.value })} rows={1} aria-label="Instructions"
                                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                                  placeholder="Instructions for the learner (optional)"
                                  className="w-full bg-transparent outline-none resize-none overflow-hidden text-xs leading-normal mt-0.5" style={{ color: EC.muted }}/>
                              </div>
                              <div className="inline-flex gap-0.5 p-0.5 rounded-full flex-shrink-0 ml-7 sm:ml-0" style={{ boxShadow: `inset 0 0 0 1px ${EC.divider}` }} role="group" aria-label="Task type">
                                {(['analytics', 'sql'] as const).map(t => (
                                  <button key={t} type="button" aria-pressed={type === t} onClick={() => updateAnalystTask(sectionId, taskId, { type: t })}
                                    className="h-6 px-2.5 rounded-full text-[11px] font-semibold" style={chip(type === t)}>{t === 'sql' ? 'SQL' : 'Analytics'}</button>
                                ))}
                              </div>
                              <button type="button" onClick={() => removeAnalystTask(sectionId, taskId)} aria-label="Remove task" className={iconBtn} style={{ color: EC.muted }}><X className="w-4 h-4"/></button>
                            </div>
                          );
                        })}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => addAnalystTask(sectionId, 'analytics')} className={btnSmClass} style={btnStyle('sec', EC)}><Plus className="w-3.5 h-3.5"/>Analytics task</button>
                          <button type="button" onClick={() => addAnalystTask(sectionId, 'sql')} className={btnSmClass} style={btnStyle('sec', EC)}><Plus className="w-3.5 h-3.5"/>SQL task</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div><button type="button" onClick={addAnalystSection} className={btnClass} style={btnStyle('sec', EC)}><Plus className="w-4 h-4"/>Add analysis phase</button></div>
            </Sect>
          )}

          {editorTab === 'disclaimer' && (
            <Sect C={EC} title="Disclaimer" first>
              <div>
                <textarea value={form.disclaimer ?? ''} onChange={e => setForm(f => ({ ...f, disclaimer: e.target.value }))} rows={3} aria-label="Disclaimer"
                  placeholder="Usage limits, accuracy notes or attribution." className={`${FIELD} resize-y`} style={field}/>
                <p className="text-xs mt-2" style={{ color: EC.muted }}>Optional. Usage limits, accuracy notes or attribution.</p>
              </div>
            </Sect>
          )}
        </Card>
      </div>
    );
  }

  // -- List ---
  const P = palette(LC);
  // The list reads a dataset's status from is_published, as Published or Draft.
  const rows = datasets.map(d => ({ ...d, status: d.is_published ? 'published' : 'draft' }));
  const term = search.trim().toLowerCase();
  const visible = rows.filter(d => matchesFilters(d, status, term, [d.title, d.category, ...(d.tags ?? [])]));
  const published = rows.filter(d => d.status === 'published').length;
  const sqlOn = rows.filter(d => d.sql_workbench_enabled).length;
  const categories = [...new Set(rows.map(d => d.category).filter(Boolean))] as string[];

  return (
    <div className="space-y-5 pb-12">
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      <PageHeader title="Data playground" sub="Datasets learners explore and practise SQL on." C={LC} actions={<>
        <button type="button" onClick={() => { setImportMsg(null); importRef.current?.click(); }} disabled={importing} className={btnClass} style={btnStyle('sec', LC)}>
          <Upload className="w-4 h-4" />
          {importing ? 'Importing...' : 'Import'}
        </button>
        {datasets.length > 0 && (
          <button type="button" onClick={exportAllDatasets} className={btnClass} style={btnStyle('sec', LC)}>
            <Download className="w-4 h-4" />
            Export all
          </button>
        )}
        <button type="button" onClick={openWhatsApp} title="Set the WhatsApp community link shown on the Data Playground" className={btnClass} style={btnStyle('sec', LC)}>
          <WhatsAppIcon size={16} />
          WhatsApp community
        </button>
        <button type="button" onClick={openCreate} className={btnClass} style={btnStyle('pri', LC)}>
          <Plus className="w-4 h-4" />
          New dataset
        </button>
      </>} />
      {importMsg && (
        <div role={importMsg.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm"
          style={importMsg.ok ? { background: LC.successBg, color: LC.successText, border: `1px solid ${LC.successBorder}` } : { background: LC.errorBg, color: LC.errorText, border: `1px solid ${LC.errorBorder}` }}>
          {importMsg.text}
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: LC.card }} />
      ) : datasets.length === 0 ? (
        <Card C={LC} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: LC.text }}>No datasets yet</p>
          <p className="text-sm mt-1" style={{ color: LC.muted }}>Create your first dataset to share with learners.</p>
        </Card>
      ) : (
        <>
          <Kpis C={LC} items={[
            { label: 'Datasets', n: rows.length, sub: categories.length ? categories.slice(0, 3).join(', ') + (categories.length > 3 ? ` and ${categories.length - 3} more` : '') : 'No categories yet', color: LC.text },
            { label: 'Published', n: published, sub: rows.length - published ? `${rows.length - published} still in draft` : 'No drafts', color: published ? P.good : LC.text },
            { label: 'SQL workbench on', n: sqlOn, sub: 'Learners can query these', color: LC.text },
          ]} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search datasets" C={LC} />
            <StatusChips value={status} onChange={setStatus} C={LC} />
          </div>
          {visible.length === 0 ? (
            <Card C={LC} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: LC.muted }}>No datasets match these filters.</p></Card>
          ) : (
            <div className={CARD_GRID}>
              {visible.map(d => {
                const files = normalizeDatasetFiles(d).length;
                const detail = [d.category, d.row_count ? `${d.row_count.toLocaleString()} rows` : '', files ? plural(files, 'file') : ''].filter(Boolean).join(', ');
                return (
                  <ContentCard key={d.id} item={d} cover={d.cover_image_url} Icon={Database} detail={detail || null} reach={null} C={LC}
                    audienceText={d.sql_workbench_enabled ? 'SQL workbench on' : 'SQL workbench off'}
                    onOpen={() => openEdit(d)}
                    menu={(close) => [
                      { label: 'Edit', sub: 'Overview, dataset, phases', icon: Edit2, onClick: () => { close(); openEdit(d); } },
                      { label: d.is_published ? 'Move to draft' : 'Publish', sub: d.is_published ? 'Hide it from learners' : 'Show it to learners', icon: Eye, onClick: () => { close(); togglePublish(d); } },
                      { label: 'Export', sub: 'Download as a file', icon: Download, onClick: () => { close(); exportDataset(d); } },
                      null,
                      { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { close(); setConfirmDelete(d); } },
                    ]} />
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete dataset?" eyebrow={confirmDelete.title} body="This cannot be undone." action="Delete dataset"
          danger onClose={() => setConfirmDelete(null)} onConfirm={async () => { const d = confirmDelete; setConfirmDelete(null); await deleteDataset(d.id); }} C={LC} />
      )}
      {waOpen && (
        <Modal title="WhatsApp community link" eyebrow="Shown as a Join our community banner on the Data Playground" onClose={() => { if (!waSaving) setWaOpen(false); }} C={LC}>
          <div className="grid gap-3">
            <p className="text-sm" style={{ color: LC.muted }}>Paste your group invite link. Leave it blank to hide the banner.</p>
            <input type="url" value={waLink} onChange={e => setWaLink(e.target.value)} aria-label="WhatsApp community link"
              placeholder={waLoading ? 'Loading...' : 'https://chat.whatsapp.com/...'} disabled={waLoading} className={FIELD} style={fieldStyle(LC)} />
            {waMsg && <p className="text-sm" style={{ color: waMsg.ok ? P.good : P.bad }}>{waMsg.text}</p>}
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
            <button type="button" onClick={() => setWaOpen(false)} disabled={waSaving} className={BUTTON} style={{ background: LC.pill, color: LC.text }}>Cancel</button>
            <button type="button" onClick={saveWhatsApp} disabled={waSaving || waLoading} className={BUTTON} style={{ background: LC.cta, color: LC.ctaText }}>
              {waSaving ? 'Saving...' : 'Save link'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
