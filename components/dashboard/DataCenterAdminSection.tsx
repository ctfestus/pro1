'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useRef, isValidElement, cloneElement } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Database, Download, Edit2, Eye, FileCode, FileText, GripVertical, Loader2, Plus, Save, Search, Sparkles, Trash2, Upload, Video, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { safeEmbedUrl, isHtmlEmbedUrl, HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';
import { downloadJSON } from '@/lib/dashboard-export';
import { PexelsImagePicker } from '@/components/PexelsImagePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LIGHT_C, DARK_C, cardStyle } from '@/lib/theme';

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
    if (!confirm('Delete this dataset?')) return;
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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 14,
    border: `1px solid ${C.cardBorder}`, background: C.input, color: C.text,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const font = 'var(--font-sans, Inter, sans-serif)';
  const isDark = C === DARK_C;
  const cardBorder = isDark ? 'none' : `1px solid ${C.cardBorder}`;

  if (view === 'editor') {
    const EDITOR_TABS = [
      { id: 'overview' as const,   label: 'Overview',        hint: 'Title, category and cover', Icon: FileText },
      { id: 'dataset' as const,    label: 'Dataset',         hint: 'File and SQL workbench',     Icon: Database },
      { id: 'phases' as const,     label: 'Analysis Phases', hint: 'Tasks for students',         Icon: Search },
      { id: 'disclaimer' as const, label: 'Disclaimer',      hint: 'Usage notes',                Icon: AlertTriangle },
    ];

    // VE-style: one cohesive C.cta accent for every section head (the `accent` arg is ignored).
    const sectionHead = (icon: React.ReactNode, label: string, _accent?: string) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isValidElement(icon) ? cloneElement(icon as React.ReactElement<{ color?: string }>, { color: C.muted }) : icon}
        </div>
        <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{label}</span>
      </div>
    );

    const card = (children: React.ReactNode) => (
      <div style={{ ...cardStyle(C), borderRadius: 18, padding: 24 }}>
        {children}
      </div>
    );

    const analystSections = normalizeAnalystSections(form.analyst_sections, form.sample_questions, form.sample_question_types);

    // Quiet, clickable type tag: shows the current task type and toggles between Analytics/SQL on click.
    const typeToggle = (active: DatasetQuestionType, onSelect: (t: DatasetQuestionType) => void) => (
      <button type="button"
        onClick={() => onSelect(active === 'sql' ? 'analytics' : 'sql')}
        title="Click to switch between Analytics and SQL"
        style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, border: 'none', background: active === 'sql' ? 'rgba(22,163,74,0.12)' : C.input, color: active === 'sql' ? '#16a34a' : C.faint, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {active === 'sql' ? 'SQL' : 'Analytics'}
      </button>
    );

    const analystSectionEditor = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {analystSections.length === 0 && (
          <div style={{ padding: '28px 16px', borderRadius: 12, background: C.page, textAlign: 'center' }}>
            <p style={{ margin: 0, color: C.faint, fontSize: 13 }}>No analysis phases yet. Add one to get started.</p>
          </div>
        )}
        {analystSections.map((section, sectionIndex) => {
          const sectionId = section.id || `section-${sectionIndex + 1}`;
          const expanded = expandedAnalystSections[sectionId] !== false;
          const isDragging = dragState?.kind === 'section' && dragState.id === sectionId;
          const isDropTarget = dragState?.kind === 'section' && dragOverId === sectionId && dragState.id !== sectionId;
          return (
            <div key={sectionId}
              data-phasecard
              onDragOver={e => { if (dragState?.kind === 'section') { e.preventDefault(); setDragOverId(sectionId); } }}
              onDrop={e => { if (dragState?.kind === 'section') { e.preventDefault(); reorderAnalystSections(dragState.id, sectionId); } setDragOverId(null); }}
              style={{ background: C.page, borderRadius: 14, overflow: 'hidden', opacity: isDragging ? 0.45 : 1, outline: isDropTarget ? `2px solid ${C.cta}` : 'none', outlineOffset: -2 }}>
              {/* Phase header */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 14px' }}>
                <span
                  draggable
                  onDragStart={e => { setDragState({ kind: 'section', sectionId, id: sectionId }); e.dataTransfer.effectAllowed = 'move'; const card = (e.currentTarget as HTMLElement).closest('[data-phasecard]'); if (card) e.dataTransfer.setDragImage(card, 20, 20); }}
                  onDragEnd={() => { setDragState(null); setDragOverId(null); }}
                  title="Drag to reorder phase"
                  style={{ cursor: 'grab', color: C.faint, display: 'flex', flexShrink: 0, padding: '0 2px' }}
                >
                  <GripVertical size={16} />
                </span>
                <button
                  type="button"
                  onClick={() => setExpandedAnalystSections(prev => ({ ...prev, [sectionId]: !expanded }))}
                  style={{ width: 26, height: 26, borderRadius: 8, border: 'none', background: 'transparent', color: C.faint, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >
                  {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.faint, flexShrink: 0 }}>{sectionIndex + 1}</span>
                <input
                  value={section.title}
                  onChange={e => updateAnalystSection(sectionId, { title: e.target.value })}
                  placeholder="Phase title, e.g. Channel and audience breakdown"
                  style={{ flex: 1, border: 'none', background: 'transparent', fontWeight: 700, fontSize: 15, color: C.text, outline: 'none', padding: '4px 0', fontFamily: 'inherit', minWidth: 0 }}
                />
                <span style={{ fontSize: 12, color: C.faint, flexShrink: 0 }}>{section.tasks.length} {section.tasks.length === 1 ? 'task' : 'tasks'}</span>
                <button onClick={() => removeAnalystSection(sectionId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', flexShrink: 0, padding: 4 }}>
                  <Trash2 size={15} />
                </button>
              </div>
              {expanded && (
                <div style={{ padding: '0 14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <RichTextEditor
                    value={section.brief ?? ''}
                    onChange={html => updateAnalystSection(sectionId, { brief: html })}
                    placeholder="Briefly describe what this phase asks the learner to investigate."
                    bgOverride={C.card}
                    enableAiAssist
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, borderRadius: 10, padding: '0 12px', border: `1px solid ${C.cardBorder}` }}>
                      <Video size={15} style={{ color: C.faint, flexShrink: 0 }} />
                      <input
                        value={section.videoUrl ?? ''}
                        onChange={e => updateAnalystSection(sectionId, { videoUrl: e.target.value })}
                        placeholder="Embed link (optional)"
                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: C.text, padding: '9px 0', fontFamily: 'inherit', minWidth: 0 }}
                      />
                      {/* Interactive HTML embed: uploads to the public form-assets bucket; the player
                          renders it sandboxed at full height (same treatment as Canva) */}
                      <label title="Upload a self-contained HTML file with inline assets (max 10 MB)" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <input type="file" accept=".html,.htm,text/html" style={{ display: 'none' }} onChange={async e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          e.target.value = '';
                          if (file.size > 10 * 1024 * 1024) { setError(`HTML file is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 10 MB.`); return; }
                          setError('');
                          try {
                            const url = await uploadToStorage(file, 'lesson-html');
                            updateAnalystSection(sectionId, { videoUrl: url });
                          } catch (err: any) { setError(err?.message || 'HTML upload failed. Please try again.'); }
                        }} />
                        <FileCode size={15} style={{ color: C.faint }} />
                      </label>
                    </div>
                    <select
                      value={section.difficulty ?? ''}
                      onChange={e => updateAnalystSection(sectionId, { difficulty: e.target.value })}
                      style={{ ...inputStyle, background: C.card, fontSize: 13, cursor: 'pointer' }}
                    >
                      <option value="">Difficulty: Auto</option>
                      <option value="Beginner">Beginner</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Advanced">Advanced</option>
                    </select>
                    <input
                      value={section.duration ?? ''}
                      onChange={e => updateAnalystSection(sectionId, { duration: e.target.value })}
                      placeholder="Duration: Auto"
                      style={{ ...inputStyle, background: C.card, fontSize: 13 }}
                    />
                  </div>
                  {(() => {
                    const embedUrl = safeEmbedUrl(section.videoUrl ?? '');
                    if (!embedUrl) return null;
                    const isHtml = isHtmlEmbedUrl(embedUrl);
                    return (
                      <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.cardBorder}` }}>
                        <iframe src={embedUrl}
                          style={{ width: '100%', border: 'none', display: 'block', ...(isHtml ? { height: 480 } : { aspectRatio: '16 / 9' }) }}
                          sandbox={isHtml ? HTML_EMBED_SANDBOX : undefined}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {section.tasks.map((task, taskIndex) => {
                      const taskId = task.id || `task-${sectionIndex + 1}-${taskIndex + 1}`;
                      const taskDragging = dragState?.kind === 'task' && dragState.id === taskId;
                      const taskDropTarget = dragState?.kind === 'task' && dragState.sectionId === sectionId && dragOverId === taskId && dragState.id !== taskId;
                      return (
                        <div key={taskId}
                          data-taskcard
                          onDragOver={e => { if (dragState?.kind === 'task' && dragState.sectionId === sectionId) { e.preventDefault(); e.stopPropagation(); setDragOverId(taskId); } }}
                          onDrop={e => { if (dragState?.kind === 'task' && dragState.sectionId === sectionId) { e.preventDefault(); e.stopPropagation(); reorderAnalystTasks(sectionId, dragState.id, taskId); } setDragOverId(null); }}
                          style={{ background: C.card, borderRadius: 10, padding: 10, opacity: taskDragging ? 0.45 : 1, outline: taskDropTarget ? `2px solid ${C.cta}` : 'none', outlineOffset: -2 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <span
                              draggable
                              onDragStart={e => { setDragState({ kind: 'task', sectionId, id: taskId }); e.dataTransfer.effectAllowed = 'move'; const card = (e.currentTarget as HTMLElement).closest('[data-taskcard]'); if (card) e.dataTransfer.setDragImage(card, 20, 20); }}
                              onDragEnd={() => { setDragState(null); setDragOverId(null); }}
                              title="Drag to reorder task"
                              style={{ cursor: 'grab', color: C.faint, display: 'flex', flexShrink: 0, marginTop: 3 }}
                            >
                              <GripVertical size={14} />
                            </span>
                            <textarea
                              value={task.prompt}
                              onChange={e => updateAnalystTask(sectionId, taskId, { prompt: e.target.value })}
                              rows={1}
                              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                              onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                              placeholder={task.type === 'sql' ? 'e.g. Which channel has the highest conversion rate?' : 'e.g. What targeting recommendation should the team make?'}
                              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, fontWeight: 600, color: C.text, fontFamily: 'inherit', minWidth: 0, resize: 'none', overflow: 'hidden', lineHeight: 1.5, padding: '2px 0' }}
                            />
                            {typeToggle(task.type ?? 'analytics', t => updateAnalystTask(sectionId, taskId, { type: t }))}
                            <button onClick={() => removeAnalystTask(sectionId, taskId)} style={{ marginTop: 2, background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', flexShrink: 0, padding: 2 }}>
                              <X size={14} />
                            </button>
                          </div>
                          <textarea
                            value={task.description ?? ''}
                            onChange={e => updateAnalystTask(sectionId, taskId, { description: e.target.value })}
                            rows={1}
                            ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                            onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                            placeholder="Instructions for the student (optional)"
                            style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, color: C.muted, resize: 'none', overflow: 'hidden', lineHeight: 1.5, fontFamily: 'inherit', marginTop: 6, boxSizing: 'border-box' }}
                          />
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button onClick={() => addAnalystTask(sectionId, 'analytics')} style={{ fontSize: 12.5, color: C.muted, background: C.input, border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, padding: '7px 11px' }}>
                        <Plus size={13} /> Analytics task
                      </button>
                      <button onClick={() => addAnalystTask(sectionId, 'sql')} style={{ fontSize: 12.5, color: C.muted, background: C.input, border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, padding: '7px 11px' }}>
                        <Plus size={13} /> SQL task
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={addAnalystSection} style={{ alignSelf: 'flex-start', fontSize: 13, color: C.cta, background: 'transparent', border: `1px solid ${C.cta}`, borderRadius: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '9px 14px' }}>
          <Plus size={15} /> Add analysis phase
        </button>
      </div>
    );

    return (
      <div style={{ fontFamily: font }}>
        {/* Sticky VE-style toolbar */}
        <div style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', marginBottom: 24, background: C.page }}>
          <button onClick={() => setView('list')} title="Back to datasets"
            style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: C.pill, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ArrowLeft size={16} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{editing ? 'Edit Dataset' : 'Create Dataset'}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={generateMetadata}
              disabled={generating || !form.file_url}
              title={!form.file_url ? 'Add a file URL or upload a file first' : 'Auto-fill title, description, tags, category and sample questions using AI'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 12, border: 'none', background: C.card, color: form.file_url ? C.text : C.faint, fontWeight: 600, fontSize: 13, cursor: form.file_url && !generating ? 'pointer' : 'default', opacity: generating ? 0.7 : 1 }}>
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
            {editing && (
              <a href="/data-playground" target="_blank" rel="noreferrer" title="Open the Data Playground"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 12, border: 'none', background: C.card, color: C.muted, fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                <Eye size={14} /> Preview
              </a>
            )}
            <button onClick={() => save(false)} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 12, border: 'none', background: C.card, color: C.muted, fontWeight: 600, fontSize: 13, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Draft
            </button>
            <button onClick={() => save(true)} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 12, border: 'none', background: C.cta, color: C.ctaText, fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {editing ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>

        {error && <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 14, color: '#ef4444', fontWeight: 600 }}>{error}</div>}

        {/* Large option switcher */}
        <div className="hide-scrollbar" style={{ display: 'flex', gap: 12, marginBottom: 20, maxWidth: 1100, overflowX: 'auto' }}>
          {EDITOR_TABS.map(t => {
            const active = editorTab === t.id;
            return (
              <button key={t.id} onClick={() => setEditorTab(t.id)}
                style={{ flex: '1 1 0', minWidth: 168, display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 14, border: 'none', background: active ? C.cta : C.card, cursor: 'pointer', textAlign: 'left', fontFamily: font, transition: 'background 0.15s' }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'rgba(255,255,255,0.2)' : C.pill }}>
                  <t.Icon size={19} color={active ? C.ctaText : C.muted} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: active ? C.ctaText : C.text, whiteSpace: 'nowrap' }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.85)' : C.faint, marginTop: 2, whiteSpace: 'nowrap' }}>{t.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {editorTab === 'overview' && (<>

            {/* Basics card */}
            {card(<>
              {sectionHead(<FileText size={16} color="white" />, 'Basic Info', '#374151')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Title *</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. West Africa Retail Sales 2020-2023" style={{ ...inputStyle, fontSize: 16, fontWeight: 600, padding: '11px 14px' }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Category</label>
                  {(() => {
                    const CATEGORIES = ['Finance', 'Human Resources', 'Fintech', 'E-Commerce', 'Marketing', 'Health Care', 'Hospitality', 'Sport', 'Retail', 'Banking', 'Telecom', 'Other'];
                    const isOther = !!form.category && !CATEGORIES.slice(0, -1).includes(form.category);
                    const selectVal = isOther ? 'Other' : (form.category ?? '');
                    return (
                      <>
                        <select
                          value={selectVal}
                          onChange={e => {
                            if (e.target.value === 'Other') setForm(f => ({ ...f, category: '' }));
                            else setForm(f => ({ ...f, category: e.target.value }));
                          }}
                          style={{ ...inputStyle, background: 'none', backgroundColor: C.input, appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 34, cursor: 'pointer' }}
                        >
                          <option value="">Select category...</option>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {(selectVal === 'Other' || isOther) && (
                          <input
                            autoFocus
                            value={isOther ? form.category ?? '' : ''}
                            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                            placeholder="Specify category..."
                            style={{ ...inputStyle, marginTop: 8 }}
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Description</label>
                  <textarea value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} placeholder="Describe the dataset, its source, and what students can learn from it." style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source</label>
                  <input value={form.source ?? ''} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g. World Bank, Kaggle, Government of Ghana" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source URL <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 12 }}>(optional)</span></label>
                  <input value={form.source_url ?? ''} onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))} placeholder="https://data.worldbank.org/..." style={inputStyle} />
                </div>
              </div>
            </>)}

            {/* Cover image card */}
            {card(<>
              {sectionHead(<Upload size={16} color="white" />, 'Cover Image', '#10a37f')}
              <PexelsImagePicker
                value={form.cover_image_url}
                altValue={form.cover_image_alt}
                onChange={(url, alt) => setForm(f => ({ ...f, cover_image_url: url, cover_image_alt: alt }))}
                onClear={() => setForm(f => ({ ...f, cover_image_url: null, cover_image_alt: null }))}
                C={C}
                token=""
                previewMaxWidth={360}
              />
            </>)}
          </>)}

          {/* File card */}
          {editorTab === 'dataset' && card(<>
              {sectionHead(<Download size={16} color="white" />, 'Dataset File', '#0891b2')}

              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: C.page, borderRadius: 10, padding: 4 }}>
                {(['link', 'upload'] as const).map(mode => (
                  <button key={mode} onClick={() => setFileMode(mode)}
                    style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
                      background: fileMode === mode ? C.card : 'transparent',
                      color: fileMode === mode ? C.text : C.faint,
                      boxShadow: fileMode === mode ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                    }}>
                    {mode === 'link' ? 'Paste URL' : 'Upload File'}
                  </button>
                ))}
              </div>

              {fileMode === 'link' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>File URL</label>
                    <input
                      value={form.file_url ?? ''}
                      placeholder="https://..."
                      style={inputStyle}
                      onChange={e => {
                        let url = e.target.value;
                        // Auto-convert GitHub blob URLs to raw URLs
                        if (/github\.com\/.+\/blob\//i.test(url)) {
                          url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                        }
                        setForm(f => ({ ...f, file_url: url }));
                      }}
                    />
                    {/github\.com|raw\.githubusercontent\.com/i.test(form.file_url ?? '') && (
                      <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 12.5, color: '#166534', lineHeight: 1.6 }}>
                        <strong>GitHub link detected.</strong> {/raw\.githubusercontent\.com/i.test(form.file_url ?? '') ? 'Raw URL confirmed - AI systems can fetch this file directly.' : 'Converted to raw URL automatically so AI systems can fetch the file directly.'}
                      </div>
                    )}
                    {/box\.com/i.test(form.file_url ?? '') && (
                      <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 12.5, color: '#92400e', lineHeight: 1.6 }}>
                        <strong>Box link detected.</strong> Box direct download links require a paid plan and are not available on free accounts. AI systems cannot read a standard Box shared link.<br /><br />
                        <strong>Free alternatives that work:</strong><br />
                        - <strong>GitHub (recommended):</strong> Upload to a public repo, copy the file URL - it will be auto-converted to a raw link here<br />
                        - <strong>Google Drive:</strong> Share publicly, change <code style={{ background: 'rgba(0,0,0,0.08)', padding: '1px 4px', borderRadius: 4 }}>/file/d/ID/view</code> to <code style={{ background: 'rgba(0,0,0,0.08)', padding: '1px 4px', borderRadius: 4 }}>/uc?export=download&id=ID</code><br />
                        - <strong>Dropbox:</strong> Share the file, change <code style={{ background: 'rgba(0,0,0,0.08)', padding: '1px 4px', borderRadius: 4 }}>?dl=0</code> to <code style={{ background: 'rgba(0,0,0,0.08)', padding: '1px 4px', borderRadius: 4 }}>?dl=1</code><br />
                        - <strong>Upload directly</strong> using the Upload File option above
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>File Name</label>
                    <input value={form.file_name ?? ''} onChange={e => setForm(f => ({ ...f, file_name: e.target.value }))} placeholder="sales_data.csv" style={inputStyle} />
                  </div>
                </div>
              )}

              {fileMode === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    onClick={() => !fileUploading && dataFileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.cta; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = C.cardBorder; }}
                    onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.cardBorder; if (e.dataTransfer.files.length) handleDataFilesUpload(e.dataTransfer.files); }}
                    style={{ border: `2px dashed ${C.cardBorder}`, borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: fileUploading ? 'default' : 'pointer', background: C.page, transition: 'border-color 0.15s' }}
                  >
                    {fileUploading
                      ? <><Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px', color: C.cta, display: 'block' }} /><p style={{ fontSize: 14, color: C.faint, margin: 0 }}>Uploading...</p></>
                      : <>
                          <Upload size={24} style={{ margin: '0 auto 8px', color: C.faint, display: 'block' }} />
                          <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>Click to upload or drag and drop</p>
                          <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>CSV, Excel (.xlsx), JSON, ZIP, PDF - max 50 MB</p>
                        </>
                    }
                    <input ref={dataFileRef} type="file" multiple accept=".csv,.xlsx,.json,.zip,.pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files?.length) handleDataFilesUpload(e.target.files); }} />
                  </div>

                  {/* Uploaded files */}
                  {normalizeDatasetFiles(form).length > 0 && (
                    <div style={{ border: `1px solid ${C.cardBorder}`, borderRadius: 10, overflow: 'hidden' }}>
                      <p style={{ margin: 0, padding: '8px 14px', fontSize: 12, fontWeight: 700, color: C.muted, background: C.page, borderBottom: `1px solid ${C.cardBorder}` }}>Uploaded files</p>
                      {normalizeDatasetFiles(form).map((file, i, files) => {
                        const isPrimary = file.url === form.file_url;
                        return (
                          <div key={file.url} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: i < files.length - 1 ? `1px solid ${C.divider}` : 'none' }}>
                            <FileText size={13} style={{ color: isPrimary ? C.cta : C.faint, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: C.text, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                            {isPrimary ? (
                              <span style={{ fontSize: 11, color: C.cta, fontWeight: 800, flexShrink: 0 }}>Primary</span>
                            ) : (
                              <button onClick={() => setPrimaryFile(file)} style={{ fontSize: 11, color: C.cta, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>Make primary</button>
                            )}
                            <button onClick={() => navigator.clipboard.writeText(file.url)} style={{ fontSize: 11, color: C.faint, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>Copy URL</button>
                            <button onClick={() => removeDatasetFile(file.url)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Table Structure</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['single', 'multiple'] as const).map(opt => (
                    <button key={opt} onClick={() => setForm(f => ({ ...f, table_type: f.table_type === opt ? null : opt }))}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: form.table_type === opt ? `${C.cta}1f` : C.input, color: form.table_type === opt ? C.cta : C.muted, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
                      {opt === 'single' ? 'Single Table' : 'Multiple Tables'}
                    </button>
                  ))}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: C.faint }}>Single = one CSV/sheet. Multiple = ZIP or workbook with several related tables.</p>
              </div>

              <button onClick={() => setForm(f => ({ ...f, sql_workbench_enabled: !f.sql_workbench_enabled }))}
                style={{ marginTop: 16, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, border: 'none', background: form.sql_workbench_enabled ? 'rgba(22,163,74,0.08)' : C.input, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: C.text }}>SQL Workbench</span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: C.faint, lineHeight: 1.45 }}>Show browser SQL practice for CSV, Excel, or ZIP table datasets.</span>
                </span>
                <span style={{ width: 38, height: 22, borderRadius: 999, background: form.sql_workbench_enabled ? '#16a34a' : C.faint, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                  <span style={{ position: 'absolute', top: 3, left: form.sql_workbench_enabled ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                </span>
              </button>
            </>)}


            {/* Analyst task sections card */}
            {editorTab === 'phases' && card(<>
              {sectionHead(<Search size={16} color="white" />, 'Analysis Phases', '#d97706')}
              <p style={{ fontSize: 12.5, color: C.faint, margin: '-6px 0 16px', lineHeight: 1.5 }}>
                Break the dataset into phases, each with its own tasks. Mark only tasks answerable with SELECT/WITH queries as SQL.
              </p>
              {analystSectionEditor}
            </>)}

            {/* Disclaimer card */}
            {editorTab === 'disclaimer' && card(<>
              {sectionHead(<AlertTriangle size={16} color="white" />, 'Disclaimer', '#7c3aed')}
              <textarea
                value={form.disclaimer ?? ''}
                onChange={e => setForm(f => ({ ...f, disclaimer: e.target.value }))}
                rows={3}
                placeholder="Optional. Note any usage restrictions, data accuracy limitations, or attribution requirements."
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </>)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: font }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: 18, color: C.text, margin: 0 }}>Data Playground</h2>
          <p style={{ fontSize: 13, color: C.faint, margin: '4px 0 0' }}>Manage datasets for students to explore and practice with.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          {datasets.length > 0 && (
            <button onClick={exportAllDatasets} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: cardBorder, background: C.card, color: C.muted, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              <Download size={14} /> Export All
            </button>
          )}
          <button onClick={() => { setImportMsg(null); importRef.current?.click(); }} disabled={importing}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: cardBorder, background: C.card, color: importMsg ? (importMsg.ok ? '#16a34a' : '#ef4444') : C.muted, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            <Upload size={14} /> {importing ? 'Importing...' : importMsg ? importMsg.text : 'Import'}
          </button>
          <button onClick={openWhatsApp} title="Set the WhatsApp community link shown on the Data Playground"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: cardBorder, background: C.card, color: '#25D366', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            <WhatsAppIcon size={15} /> WhatsApp Community
          </button>
          <button onClick={openCreate} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: C.cta, color: C.ctaText, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            <Plus size={15} /> New Dataset
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: C.faint }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: 13 }}>Loading datasets...</p>
        </div>
      )}

      {!loading && datasets.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, ...cardStyle(C), borderRadius: 16 }}>
          <Database size={36} style={{ color: C.faint, margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>No datasets yet</p>
          <p style={{ fontSize: 13, color: C.faint, marginBottom: 16 }}>Create your first dataset to share with students.</p>
          <button onClick={openCreate} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: C.cta, color: C.ctaText, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            New Dataset
          </button>
        </div>
      )}

      {!loading && datasets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {datasets.map(d => (
            <div key={d.id} style={{ ...cardStyle(C), borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
              {d.cover_image_url && (
                <img src={d.cover_image_url} alt={d.cover_image_alt ?? ''} style={{ width: 72, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              )}
              {!d.cover_image_url && (
                <div style={{ width: 72, height: 48, borderRadius: 8, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Database size={22} style={{ color: C.green }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14, color: C.text, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</p>
                <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>
                  {d.category && <>{d.category}</>}
                  {d.row_count ? `${d.category ? ' · ' : ''}${d.row_count.toLocaleString()} rows` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button onClick={() => togglePublish(d)} style={{
                  padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: d.is_published ? 'rgba(22,163,74,0.12)' : C.pill,
                  color: d.is_published ? '#16a34a' : C.muted,
                }}>
                  {d.is_published ? 'Published' : 'Draft'}
                </button>
                <span title={d.sql_workbench_enabled ? 'SQL Workbench enabled' : 'SQL Workbench disabled'} style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: d.sql_workbench_enabled ? 'rgba(22,163,74,0.12)' : C.pill,
                  color: d.sql_workbench_enabled ? '#16a34a' : C.faint,
                }}>
                  SQL {d.sql_workbench_enabled ? 'On' : 'Off'}
                </span>
                <button onClick={() => exportDataset(d)} title="Export" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4 }}>
                  <Download size={15} />
                </button>
                <button onClick={() => openEdit(d)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4 }}>
                  <Edit2 size={15} />
                </button>
                <button onClick={() => deleteDataset(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {waOpen && (
        <div onClick={() => !waSaving && setWaOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...cardStyle(C), borderRadius: 16, padding: 24, width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <WhatsAppIcon size={20} color="#fff" />
              </span>
              <h3 style={{ fontWeight: 700, fontSize: 16, color: C.text, margin: 0, flex: 1 }}>WhatsApp community link</h3>
              <button onClick={() => setWaOpen(false)} style={{ border: 'none', background: 'transparent', color: C.faint, cursor: 'pointer', padding: 4, display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 16px', lineHeight: 1.5 }}>
              Paste your group invite link. It shows as a &quot;Join our community&quot; banner on the Data Playground. Leave blank to hide the banner.
            </p>
            <input type="url" value={waLink} onChange={e => setWaLink(e.target.value)}
              placeholder={waLoading ? 'Loading...' : 'https://chat.whatsapp.com/...'} disabled={waLoading}
              style={{ ...inputStyle }} />
            {waMsg && (
              <p style={{ fontSize: 12.5, fontWeight: 600, color: waMsg.ok ? '#16a34a' : '#ef4444', margin: '10px 0 0' }}>{waMsg.text}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setWaOpen(false)} disabled={waSaving}
                style={{ padding: '9px 16px', borderRadius: 10, border: cardBorder, background: C.card, color: C.muted, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveWhatsApp} disabled={waSaving || waLoading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: C.cta, color: C.ctaText, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: (waSaving || waLoading) ? 0.6 : 1 }}>
                {waSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
