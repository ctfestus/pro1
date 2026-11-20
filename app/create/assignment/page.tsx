'use client';

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadCoverImage } from '@/lib/uploadToCloudinary';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { ImageLibrary } from '@/components/ImageLibrary';
import { DARK_C, useC, type ThemeColors } from '@/lib/theme';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Check, Plus, Trash2, Loader2, Link as LinkIcon, Upload, X, XCircle, Eye } from 'lucide-react';
import dynamic from 'next/dynamic';
const AssignmentExperiencePlayer = dynamic(() => import('@/components/AssignmentExperiencePlayer'), { ssr: false });
const StandardAssignmentPlayer = dynamic(() => import('@/components/StandardAssignmentPlayer'), { ssr: false });
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { sanitizeRichText, sanitizePlainText } from '@/lib/sanitize';
import { ScenariosEditor } from '@/components/create/ScenariosEditor';
import type { AssignmentScenario } from '@/lib/assignment-scenarios';
import { stripAnswerKeys, extractAnswerKeys, validateScenarioConfig, DEFAULT_PASS_MARK } from '@/lib/assignment-scenarios';
import { ALLOWED_SOLUTION_EXTENSIONS, isAllowedSolutionFile, isCompleteSolution, requestSolutionCleanup } from '@/lib/assignment-solutions';
import type { LessonDoc } from '@/lib/lesson-doc';
import { RubricFileImportActions } from '@/components/RubricFileImportActions';
import { mergeRubricCriteria, type RubricImportKind } from '@/lib/rubric-criteria';
import { excelReviewSaveErrorMessage, normalizeReviewSheetNames } from '@/lib/excel-review-config';
import { DateField } from '@/components/DatePicker';
import { MenuSelect } from '@/components/MenuSelect';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { FIELD, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette, plural, shortDate } from '@/components/dashboard/subscriptions/ui';


type AssignmentType = 'standard' | 'code_review' | 'excel_review' | 'dashboard_critique' | 'virtual_experience' | 'document_review';

// The two types offered when creating a NEW assignment. A Standard assignment is now built
// from scenarios + tasks (any mix of formats). The legacy single-purpose AI types below are
// no longer offered up front, but existing assignments of those types stay fully editable.
const ASSIGNMENT_TYPES: { value: AssignmentType; label: string }[] = [
  { value: 'standard',            label: 'Standard' },
  { value: 'virtual_experience',  label: 'Virtual Experience' },
];

// Labels for every type, including the retired ones, so an existing legacy assignment still
// shows a correct badge when edited.
const LEGACY_TYPE_LABELS: Record<string, string> = {
  code_review: 'Code Review', excel_review: 'Excel Review',
  dashboard_critique: 'Dashboard', document_review: 'Document Review',
};

interface Resource {
  id: string;
  name: string;
  url: string;
  resource_type: 'link' | 'file';
}

// A solution entry being authored. Files are uploaded to the private solutions bucket as soon as
// they are picked (`storage_path` is what gets stored); links carry a URL instead.
interface SolutionDraft {
  id: string;
  name: string;
  kind: 'file' | 'link';
  storage_path?: string;
  url?: string;
}

interface Course {
  id: string;
  title: string;
}

interface VEForm {
  id: string;
  title: string;
  slug: string;
}

// "relation does not exist" / "not in the schema cache" -- the solutions table (migration 144) has
// not been applied on this environment.
function isMissingSolutionsTable(err: any): boolean {
  const code = err?.code ?? '';
  return code === '42P01' || code === 'PGRST205' || /schema cache/i.test(err?.message ?? '');
}

/** One titled section of the editor card; sections after the first get a divider line. */
function Sect({ title, aside, action, first, children, C }: { title: string; aside?: string; action?: ReactNode; first?: boolean; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="p-5 grid gap-4" style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex-1" style={{ color: C.text }}>{title}</h3>
        {aside && <span className="text-xs" style={{ color: C.muted }}>{aside}</span>}
        {action}
      </div>
      {children}
    </div>
  );
}

export default function CreateAssignmentPage() {
  const theme = useC();
  const isDark = theme.page === DARK_C.page;
  // As on the admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const router = useRouter();

  const [editId, setEditId]       = useState<string | null>(null);
  const [activeStudioTab, setActiveStudioTab] = useState<'type' | 'details' | 'content' | 'resources' | 'settings'>('type');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [courses, setCourses]     = useState<Course[]>([]);
  const [veForms, setVeForms]     = useState<VEForm[]>([]);

  // Assignment type + config
  const [assignmentType, setAssignmentType] = useState<AssignmentType>('standard');
  const [rubricText, setRubricText]         = useState('');        // one criterion per line
  const [minScore, setMinScore]             = useState<number>(70);
  const [passingScore, setPassingScore]     = useState<number>(DEFAULT_PASS_MARK); // submission pass grade
  const [schema, setSchema]                 = useState('');        // for code_review
  const [context, setContext]               = useState('');        // for excel_review
  const [reviewSheetNamesText, setReviewSheetNamesText] = useState(''); // one worksheet per line
  const [veFormId, setVeFormId]             = useState('');        // for virtual_experience
  const [scenarios, setScenarios]           = useState<AssignmentScenario[]>([]); // for standard
  const [introDoc, setIntroDoc]             = useState<LessonDoc | undefined>(undefined); // standard overview (interactive)
  const [introBody, setIntroBody]           = useState('');   // HTML fallback of introDoc

  // Core fields
  const [title, setTitle]                         = useState('');
  const [scenario, setScenario]                   = useState('');
  const [brief, setBrief]                         = useState('');
  const [tasks, setTasks]                         = useState('');
  const [requirements, setRequirements]           = useState('');
  const [submissionInstructions, setSubmissionInstructions] = useState('');
  const [relatedCourse, setRelatedCourse]         = useState('');
  const [coverImage, setCoverImage]               = useState('');
  const [showCoverLibrary, setShowCoverLibrary]   = useState(false);
  const [status, setStatus]                       = useState<'draft' | 'published'>('draft');
  const [originalStatus, setOriginalStatus]       = useState<'draft' | 'published'>('draft');
  const [resources, setResources]                 = useState<Resource[]>([]);
  const [solutions, setSolutions]                 = useState<SolutionDraft[]>([]);
  const [solutionUploading, setSolutionUploading] = useState(false);
  // Every solution file this assignment referenced when the editor opened, plus anything uploaded
  // since. After a successful save these are offered for cleanup: whatever the saved assignment no
  // longer references gets removed from the private bucket (the server re-checks, so a file another
  // assignment still uses is kept).
  const uploadedSolutionPaths = useRef<Set<string>>(new Set());
  const [cohorts, setCohorts]                     = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [originalCohortIds, setOriginalCohortIds] = useState<string[]>([]);
  const [groups, setGroups]                       = useState<{ id: string; name: string; cohort_id: string }[]>([]);
  const [selectedGroupIds, setSelectedGroupIds]   = useState<string[]>([]);
  const [originalGroupIds, setOriginalGroupIds]   = useState<string[]>([]);
  const [audienceMode, setAudienceMode]           = useState<'cohorts' | 'groups'>('cohorts');
  const [deadlineDate, setDeadlineDate]           = useState('');
  const [coverUploading, setCoverUploading]       = useState(false);
  const [resourceUploading, setResourceUploading] = useState<Record<string, boolean>>({});
  const [extracting, setExtracting]               = useState<RubricImportKind | null>(null);
  const [showPreview, setShowPreview]             = useState(false);
  const [previewVeConfig, setPreviewVeConfig]     = useState<any>(null);
  const [loadingPreviewVe, setLoadingPreviewVe]   = useState(false);
  const [editorReady, setEditorReady]             = useState(false);
  const autoPreviewOpened = useRef(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const solutionFileRef = useRef<HTMLInputElement>(null);
  const resourceFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleGroup = (id: string) =>
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase
        .from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin'].includes(profile.role)) {
        router.replace('/dashboard'); return;
      }

      const [{ data: coursesData }, { data: cohortsData }, { data: veData }, groupsRes] = await Promise.all([
        supabase.from('courses').select('id, title').eq('user_id', session.user.id).order('title'),
        supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name'),
        supabase.from('virtual_experiences').select('id, title, slug').eq('user_id', session.user.id).order('title'),
        fetch('/api/groups', { headers: { Authorization: `Bearer ${session.access_token}` } }).then(r => r.json()),
      ]);
      if (coursesData) setCourses(coursesData);
      if (cohortsData) setCohorts(cohortsData);
      if (veData) setVeForms(veData.map((v: any) => ({ id: v.id, title: v.title || 'Untitled VE', slug: v.slug })));
      if (groupsRes?.groups) setGroups(groupsRes.groups.map((g: any) => ({ id: g.id, name: g.name, cohort_id: g.cohort_id })));

      if (id) {
        const [{ data }, { data: resData }, { data: solData }] = await Promise.all([
          supabase.from('assignments').select('*').eq('id', id).single(),
          supabase.from('assignment_resources').select('*').eq('assignment_id', id),
          supabase.from('assignment_solutions').select('*').eq('assignment_id', id).order('created_at'),
        ]);
        if (data) {
          setTitle(data.title ?? '');
          setScenario(data.scenario ?? '');
          setBrief(data.brief ?? '');
          setTasks(data.tasks ?? '');
          setRequirements(data.requirements ?? '');
          setSubmissionInstructions(data.submission_instructions ?? '');
          setRelatedCourse(data.related_course ?? '');
          setCoverImage(data.cover_image ?? '');
          const loadedStatus = (data.status ?? 'draft') as 'draft' | 'published';
          setStatus(loadedStatus);
          setOriginalStatus(loadedStatus);
          if (data.deadline_date) setDeadlineDate(data.deadline_date);
          if (data.cohort_ids?.length) {
            setSelectedCohortIds(data.cohort_ids);
            setOriginalCohortIds(data.cohort_ids);
          }
          if (data.group_ids?.length) {
            setSelectedGroupIds(data.group_ids);
            setOriginalGroupIds(data.group_ids);
            setAudienceMode('groups');
          }
          if (data.type) setAssignmentType(data.type);
          if (data.config) {
            const cfg = data.config;
            if (cfg.rubric?.length) setRubricText(cfg.rubric.join('\n'));
            if (cfg.minScore != null) setMinScore(cfg.minScore);
            if (cfg.passingScore != null) setPassingScore(cfg.passingScore);
            if (cfg.schema) setSchema(cfg.schema);
            if (cfg.context) setContext(cfg.context);
            if (Array.isArray(cfg.reviewSheetNames)) setReviewSheetNamesText(cfg.reviewSheetNames.join('\n'));
            if (cfg.ve_form_id) setVeFormId(cfg.ve_form_id);
            if (Array.isArray(cfg.scenarios)) {
              // Answer keys live in a server-only table; re-inject them into the editor state.
              const { data: keyRow } = await supabase.from('assignment_answer_keys').select('keys').eq('assignment_id', id).maybeSingle();
              const keys = (keyRow?.keys ?? {}) as Record<string, string>;
              setScenarios(cfg.scenarios.map((s: any) => ({
                ...s,
                tasks: (s.tasks ?? []).map((t: any) => (t.type === 'mcq' && keys[t.id] != null ? { ...t, correctAnswer: keys[t.id] } : t)),
              })));
            }
            if (cfg.introDoc) setIntroDoc(cfg.introDoc);
            if (cfg.introBody) setIntroBody(cfg.introBody);
          }
        }
        if (resData) setResources(resData.map((r: any) => ({ id: r.id, name: r.name, url: r.url, resource_type: r.resource_type })));
        if (solData) {
          setSolutions(solData.map((s: any) => ({ id: s.id, name: s.name, kind: s.kind, storage_path: s.storage_path ?? undefined, url: s.url ?? undefined })));
          for (const s of solData) if (s.storage_path) uploadedSolutionPaths.current.add(s.storage_path);
        }
      }
      setEditorReady(true);
    };
    init();
  }, [router]);

  function buildConfig(): Record<string, any> | null {
    const rubric = rubricText.split('\n').map(s => s.trim()).filter(Boolean);
    const reviewSheetNames = normalizeReviewSheetNames(reviewSheetNamesText.split('\n')).names;
    const normalizedScenarios = scenarios.map(scenario => ({
      ...scenario,
      tasks: scenario.tasks.map(task => {
        if (task.type !== 'excel_review') return task;
        return { ...task, reviewSheetNames: normalizeReviewSheetNames(task.reviewSheetNames).names };
      }),
    }));
    const base: Record<string, any> | null = (() => {
      switch (assignmentType) {
        case 'standard':           return normalizedScenarios.length ? { scenarios: stripAnswerKeys(normalizedScenarios), ...(introDoc ? { introDoc } : {}), ...(introBody.trim() ? { introBody: sanitizeRichText(introBody) } : {}) } : null;
        case 'code_review':        return { rubric, minScore, ...(schema.trim() ? { schema: schema.trim() } : {}) };
        case 'excel_review':       return { rubric, minScore, ...(context.trim() ? { context: context.trim() } : {}), ...(reviewSheetNames.length ? { reviewSheetNames } : {}) };
        case 'dashboard_critique': return { rubric };
        case 'document_review':    return { rubric, minScore, ...(context.trim() ? { context: context.trim() } : {}) };
        case 'virtual_experience': return veFormId ? { ve_form_id: veFormId } : null;
        default:                   return null;
      }
    })();
    if (!base) return null;
    // The submission passing grade applies to every assignment type (resubmit / solution release /
    // grade notifications / pass-fail all read it). Clamp to a sane 1-100.
    return { ...base, passingScore: Math.min(100, Math.max(1, Math.round(passingScore))) };
  }

  // -- Solution files (released to a student only after their submission is graded) ---
  function addSolutionLink() {
    setSolutions(prev => [...prev, { id: crypto.randomUUID(), name: '', kind: 'link', url: '' }]);
  }
  function removeSolution(id: string) { setSolutions(prev => prev.filter(s => s.id !== id)); }
  function updateSolution(id: string, field: 'name' | 'url', value: string) {
    setSolutions(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }

  // Files upload immediately (like resource files) so the editor only ever holds a storage path.
  // The object goes to the PRIVATE solutions bucket via the service-role route -- there is no
  // public URL, so nothing is exposed before the assignment is even saved.
  async function handleSolutionFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setSolutionUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      for (const file of files) {
        if (!isAllowedSolutionFile(file.name)) throw new Error(`File type not allowed: ${file.name}`);
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/assignments/solution-upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Solution upload failed.');
        uploadedSolutionPaths.current.add(json.path);
        setSolutions(prev => [...prev, { id: crypto.randomUUID(), name: file.name, kind: 'file', storage_path: json.path }]);
      }
    } catch (err: any) {
      setError(err?.message || 'Solution upload failed.');
    } finally {
      setSolutionUploading(false);
    }
  }

  function addResource() {
    setResources(prev => [...prev, { id: crypto.randomUUID(), name: '', url: '', resource_type: 'link' }]);
  }
  function removeResource(id: string) { setResources(prev => prev.filter(r => r.id !== id)); }
  function updateResource(id: string, field: keyof Resource, value: string) {
    setResources(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function handleExtractRubric(label: RubricImportKind, file: File) {
    setExtracting(label);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      form.append('reviewSheetNames', JSON.stringify(assignmentType === 'excel_review' ? reviewSheetNamesText.split('\n') : []));

      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Extraction failed.'); return; }

      const incoming: string[] = json.criteria ?? [];
      setRubricText(prev => {
        const existing = prev.split('\n');
        return mergeRubricCriteria(existing, incoming).join('\n');
      });
    } catch {
      setError('Failed to extract rubric. Please try again.');
    } finally {
      setExtracting(null);
    }
  }

  // `target` is the status this save asks for: the header's Save draft and Publish pass it in, so
  // the save does not depend on a status update that has not landed yet.
  async function handleSubmit(e: React.FormEvent | null, target: 'draft' | 'published' = status) {
    e?.preventDefault();
    setStatus(target);
    setError('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }
    if (assignmentType === 'virtual_experience' && !veFormId) {
      setError('Please select a Virtual Experience.'); return;
    }
    const configuredSheetLists = assignmentType === 'excel_review'
      ? [reviewSheetNamesText.split('\n')]
      : scenarios.flatMap(scenario => scenario.tasks.filter(task => task.type === 'excel_review').map(task => task.reviewSheetNames));
    for (const configuredSheets of configuredSheetLists) {
      const normalized = normalizeReviewSheetNames(configuredSheets);
      if (normalized.error) { setError(normalized.error); return; }
    }
    // Block publishing an incomplete scenario assignment (drafts may stay incomplete).
    if (assignmentType === 'standard' && target === 'published') {
      const vErrs = validateScenarioConfig({ scenarios });
      if (vErrs.length) { setError(vErrs.slice(0, 3).join(' ') + (vErrs.length > 3 ? ` (+${vErrs.length - 3} more)` : '')); return; }
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const wantPublished = target === 'published';

      // B-lite publish safety: a published assignment must never exist without its matching
      // answer keys / resources. So always write the CONTENT as a draft first (creating, or
      // flipping an already-published edit back to draft in the same atomic update), save keys
      // and resources, and only THEN flip to published. If any step fails it stays a draft.
      const draftPayload: any = {
        title:                    trimmedTitle,
        scenario:                 sanitizeRichText(scenario) || null,
        brief:                    sanitizeRichText(brief) || null,
        tasks:                    sanitizeRichText(tasks) || null,
        requirements:             sanitizeRichText(requirements) || null,
        submission_instructions:  sanitizeRichText(submissionInstructions) || null,
        related_course:           relatedCourse || null,
        cover_image:              coverImage.trim() || null,
        status:                   'draft',
        cohort_ids:               audienceMode === 'cohorts' ? selectedCohortIds : [],
        group_ids:                audienceMode === 'groups'  ? selectedGroupIds  : [],
        deadline_date:            deadlineDate || null,
        type:                     assignmentType,
        config:                   buildConfig(),
      };

      // Resources/solutions are replaced by inserting the new rows first and deleting the old ones
      // only afterwards (see below). Capture the existing ids here but do NOT delete yet, so a
      // failure mid-save can never leave the draft with its old data already gone.
      const oldResourceIds: string[] = [];
      const oldSolutionIds: string[] = [];
      let assignmentId = editId;
      if (editId) {
        const { error: updateError } = await supabase.from('assignments').update(draftPayload).eq('id', editId);
        if (updateError) throw updateError;
        const { data: oldRes, error: oldResErr } = await supabase.from('assignment_resources').select('id').eq('assignment_id', editId);
        if (oldResErr) throw new Error('Could not read existing resources. The assignment was left as a draft - please try saving again.');
        oldResourceIds.push(...(oldRes ?? []).map((r: any) => r.id));
        // Tolerated when the table itself is missing (a tenant that has not applied migration 144
        // yet): editing an assignment must not break there. A real save of solutions still errors
        // loudly below.
        const { data: oldSol, error: oldSolErr } = await supabase.from('assignment_solutions').select('id').eq('assignment_id', editId);
        if (oldSolErr && !isMissingSolutionsTable(oldSolErr)) throw new Error('Could not read existing solution files. The assignment was left as a draft - please try saving again.');
        oldSolutionIds.push(...(oldSol ?? []).map((s: any) => s.id));
      } else {
        const { data: assignment, error: assignmentError } = await supabase
          .from('assignments').insert({ ...draftPayload, created_by: session.user.id }).select('id').single();
        if (assignmentError) throw assignmentError;
        assignmentId = assignment.id;
      }
      if (!assignmentId) throw new Error('Assignment could not be resolved.');

      // MCQ answer keys (server-only table). On failure the assignment stays a draft.
      if (assignmentType === 'standard') {
        const { error: keyErr } = await supabase.from('assignment_answer_keys')
          .upsert({ assignment_id: assignmentId, keys: extractAnswerKeys(scenarios) }, { onConflict: 'assignment_id' });
        if (keyErr) throw new Error('Could not save the answer keys. The assignment was left as a draft - please try saving again.');
      }

      const validResources = resources.filter(r => r.name.trim() && r.url.trim());
      if (validResources.length > 0) {
        const { error: resourcesError } = await supabase.from('assignment_resources').insert(
          validResources.map(r => ({ assignment_id: assignmentId, name: r.name.trim(), url: r.url.trim(), resource_type: r.resource_type }))
        );
        if (resourcesError) throw new Error('Could not save resources. The assignment was left as a draft - please try saving again.');
      }

      // Solution files: instructor-only until a student's submission is graded (RLS + private
      // bucket, migration 144). Same draft-first safety as resources.
      const validSolutions = solutions.filter(isCompleteSolution);
      if (validSolutions.length > 0) {
        const { error: solutionsError } = await supabase.from('assignment_solutions').insert(
          validSolutions.map(s => ({
            assignment_id: assignmentId,
            name: s.name.trim(),
            kind: s.kind,
            storage_path: s.kind === 'file' ? s.storage_path : null,
            url: s.kind === 'link' ? s.url!.trim() : null,
          }))
        );
        if (solutionsError) {
          throw new Error(isMissingSolutionsTable(solutionsError)
            ? 'Solution files need database migration 144 on this environment. The assignment was left as a draft.'
            : 'Could not save the solution files. The assignment was left as a draft - please try saving again.');
        }
      }

      // The new rows are in, so now remove the ones this edit replaced. Deleting AFTER the inserts
      // means any failure above left the originals intact (the draft never loses its data); the
      // worst case here is old + new both lingering on a draft, which the instructor can re-save.
      if (editId && oldResourceIds.length) {
        const { error: delErr } = await supabase.from('assignment_resources').delete().in('id', oldResourceIds);
        if (delErr) throw new Error('Saved the new resources but could not remove the previous ones. The assignment was left as a draft - please try saving again.');
      }
      if (editId && oldSolutionIds.length) {
        const { error: delSolErr } = await supabase.from('assignment_solutions').delete().in('id', oldSolutionIds);
        if (delSolErr && !isMissingSolutionsTable(delSolErr)) throw new Error('Saved the new solution files but could not remove the previous ones. The assignment was left as a draft - please try saving again.');
      }

      // Flip to published only after content, keys, resources, and solutions all saved.
      if (wantPublished) {
        const { error: pubErr } = await supabase.from('assignments').update({ status: 'published' }).eq('id', assignmentId);
        if (pubErr) throw new Error('Content saved, but publishing failed. The assignment is a draft - please try publishing again.');
      }

      // Send notification emails after publication succeeds (before navigating away).
      if (wantPublished) {
        const isPublishingNow = !editId || originalStatus !== 'published';
        const cohortsToNotify = audienceMode === 'cohorts'
          ? (isPublishingNow ? selectedCohortIds : selectedCohortIds.filter(id => !originalCohortIds.includes(id)))
          : [];
        const groupsToNotify = audienceMode === 'groups'
          ? (isPublishingNow ? selectedGroupIds : selectedGroupIds.filter(id => !originalGroupIds.includes(id)))
          : [];
        if (cohortsToNotify.length > 0 || groupsToNotify.length > 0) {
          const notifyRes = await fetch('/api/assignments/notify-cohorts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ assignmentId, cohortIds: cohortsToNotify, groupIds: groupsToNotify }),
          });
          if (!notifyRes.ok) {
            const notifyJson = await notifyRes.json().catch(() => ({}));
            throw new Error(notifyJson.error || 'Assignment published but notification failed.');
          }
        }
      }

      // Bin any solution file this assignment no longer references (a removed entry, or one
      // uploaded and then taken out before saving). Fire-and-forget after the save succeeded; the
      // server keeps anything another assignment still points at.
      if (uploadedSolutionPaths.current.size > 0) {
        requestSolutionCleanup([...uploadedSolutionPaths.current], session.access_token);
      }

      router.push('/dashboard#assignments');
    } catch (err: any) {
      setError(excelReviewSaveErrorMessage(err, 'Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResourceFileUpload(resourceId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResourceUploading(prev => ({ ...prev, [resourceId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/assignments/github-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'File upload failed.');
      updateResource(resourceId, 'url', json.url);
      if (!resources.find(r => r.id === resourceId)?.name) updateResource(resourceId, 'name', file.name);
    } catch (err: any) {
      setError(err?.message || 'File upload failed.');
    } finally {
      setResourceUploading(prev => ({ ...prev, [resourceId]: false }));
      e.target.value = '';
    }
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const ref = await uploadCoverImage(file, 'covers');
      setCoverImage(ref);
    } catch (err: any) {
      setError(err?.message || 'Image upload failed.');
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  }

  const isLegacyType = !ASSIGNMENT_TYPES.some(t => t.value === assignmentType) && assignmentType !== 'standard';
  const showContentFields = assignmentType !== 'virtual_experience';
  const studioTabs = [
    { id: 'type', label: 'Type' },
    { id: 'details', label: 'Details' },
    { id: 'content', label: 'Content' },
    { id: 'resources', label: 'Resources' },
    { id: 'settings', label: 'Settings' },
  ] as const;
  const P = palette(C);
  const field = inputStyle(C);
  const labelCls = 'text-xs font-semibold mb-2 block';
  const typeLabel = assignmentType === 'standard' ? 'Standard'
    : assignmentType === 'virtual_experience' ? 'Virtual experience'
    : LEGACY_TYPE_LABELS[assignmentType] ?? assignmentType;
  const taskCount = scenarios.reduce((n, s) => n + s.tasks.length, 0);
  const chip = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { color: C.muted });
  // A page-coloured choice with a radio; the chosen one gets a blue ring.
  const choice = (on: boolean, onClick: () => void, title: string, sub: string) => (
    <button key={title} type="button" role="radio" aria-checked={on} onClick={onClick}
      className="flex items-start gap-3 p-4 rounded-2xl text-left" style={{ background: C.page, boxShadow: on ? `inset 0 0 0 2px ${P.sel}` : 'none' }}>
      <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={on ? { background: P.sel } : { background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
        {on && <span className="w-2 h-2 rounded-full" style={{ background: P.onSel }}/>}
      </span>
      <span>
        <span className="block text-sm font-semibold" style={{ color: C.text }}>{title}</span>
        <span className="block text-xs" style={{ color: C.muted }}>{sub}</span>
      </span>
    </button>
  );
  const removeBtn = (onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} aria-label={label} className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}>
      <Trash2 className="w-4 h-4"/>
    </button>
  );

  const openPreview = async () => {
    if (assignmentType === 'virtual_experience' && veFormId) {
      setLoadingPreviewVe(true);
      const { data: ve } = await supabase
        .from('virtual_experiences')
        .select('id, title, slug, modules, company, role, industry, tagline, description, cover_image, manager_name, manager_title, guide_id, guide_snapshot, dataset, background, difficulty, duration, tools, tool_logos, learn_outcomes, theme, mode, font, custom_accent, is_short_course, badge_image_url')
        .eq('id', veFormId).single();
      if (ve) {
        setPreviewVeConfig({
          isVirtualExperience: true as const,
          title: ve.title,
          company: ve.company,
          role: ve.role,
          industry: ve.industry,
          modules: ve.modules ?? [],
          tagline: ve.tagline,
          coverImage: ve.cover_image,
          description: ve.description,
          toolLogos: ve.tool_logos ?? {},
          theme: ve.theme,
          mode: ve.mode,
          font: ve.font,
          customAccent: ve.custom_accent,
          badgeImageUrl: ve.badge_image_url,
          managerName: ve.manager_name,
          managerTitle: ve.manager_title,
          guideId: ve.guide_id,
          guideSnapshot: ve.guide_snapshot,
          dataset: ve.dataset,
          background: ve.background,
          difficulty: ve.difficulty,
          duration: ve.duration,
          tools: ve.tools ?? [],
          learnOutcomes: ve.learn_outcomes ?? [],
        });
      }
      setLoadingPreviewVe(false);
    }
    setShowPreview(true);
  };

  // Assignment reports link here with `preview=1`. Reuse the real editor preview instead of
  // maintaining a second renderer in the reporting page.
  useEffect(() => {
    if (!editorReady || !editId || autoPreviewOpened.current) return;
    if (new URLSearchParams(window.location.search).get('preview') !== '1') return;
    autoPreviewOpened.current = true;
    previewButtonRef.current?.click();
  }, [editorReady, editId]);

  return (
    <div style={{ minHeight: '100vh', background: C.page }}>
      <main className="max-w-[1040px] mx-auto px-4 sm:px-6 pt-7 pb-16">
        {/* Header: back to the list, the name with its saved status and key facts, and the buttons. */}
        <Link href="/dashboard#assignments" className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 no-underline hover:opacity-80" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4"/>All assignments
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title.trim() || 'New assignment'}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm" style={{ color: C.muted }}>
              {originalStatus === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
              <span>{typeLabel}</span>
              {assignmentType === 'standard' && <span>{plural(scenarios.length, 'scenario')}, {plural(taskCount, 'task')}</span>}
              {deadlineDate && <span>Due <b style={{ color: C.text }}>{shortDate(deadlineDate)}</b></span>}
              <span>Pass mark <b style={{ color: C.text }}>{passingScore}%</b></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button ref={previewButtonRef} type="button" onClick={openPreview} disabled={loadingPreviewVe} className={btnClass} style={btnStyle('sec', C)}>
              {loadingPreviewVe ? <Loader2 className="w-4 h-4 animate-spin"/> : <Eye className="w-4 h-4"/>}Preview
            </button>
            <button type="button" onClick={() => handleSubmit(null, 'draft')} disabled={loading} className={btnClass} style={btnStyle('sec', C)}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}Save draft
            </button>
            <button type="button" onClick={() => handleSubmit(null, 'published')} disabled={loading} className={btnClass} style={btnStyle('pri', C)}>
              {originalStatus === 'published' ? 'Publish changes' : 'Publish'}
            </button>
          </div>
        </div>
        <div role="tablist" aria-label="Assignment sections" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
          {studioTabs.map(tab => (
            <button key={tab.id} type="button" role="tab" aria-selected={activeStudioTab === tab.id} onClick={() => setActiveStudioTab(tab.id)}
              className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap" style={activeStudioTab === tab.id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
              {tab.label}
            </button>
          ))}
        </div>
        {error && (
          <div role="alert" className="mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
            <XCircle className="w-4 h-4 flex-shrink-0"/>
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4"/></button>
          </div>
        )}

        <form id="assignment-form" onSubmit={e => handleSubmit(e)} noValidate>
        <Card C={C} className="mt-4 overflow-hidden">

          {/* -- Type --- */}
          {activeStudioTab === 'type' && (
            <Sect title="How learners complete it" first C={C}>
              <div role="radiogroup" aria-label="Assignment type" className="grid gap-3 sm:grid-cols-2">
                {choice(assignmentType === 'standard', () => setAssignmentType('standard'), 'Standard', 'Scenarios and tasks of any kind: written, upload, multiple choice, AI review')}
                {choice(assignmentType === 'virtual_experience', () => setAssignmentType('virtual_experience'), 'Virtual experience', 'Learners complete a full virtual experience')}
              </div>
              <p className="text-xs" style={{ color: C.muted }}>This decides what the Content tab offers.</p>
              {isLegacyType && (
                <p className="text-xs" style={{ color: C.muted }}>
                  You are editing an older {LEGACY_TYPE_LABELS[assignmentType] ?? assignmentType} assignment. Its settings still work. New assignments are built as Standard scenarios and tasks.
                </p>
              )}
            </Sect>
          )}

          {/* -- Details --- */}
          {activeStudioTab === 'details' && (
            <Sect title="Details" first C={C}>
              <div>
                <label htmlFor="asg-title" className={labelCls} style={{ color: C.muted }}>Title</label>
                <input id="asg-title" type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                  placeholder="For example, Week 3 data analysis" className={FIELD} style={field} required maxLength={255}/>
              </div>
              <div>
                <span className={labelCls} style={{ color: C.muted }}>Cover image</span>
                <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload}/>
                <div className="rounded-xl p-4 grid gap-3 text-center text-[13px]" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>
                  {coverImage
                    ? <img src={resolveCoverUrl(coverImage)} alt="Cover" className="w-full h-[190px] rounded-xl object-cover" onError={e => (e.target as HTMLImageElement).style.display = 'none'}/>
                    : <span>A clear image learners recognise at a glance</span>}
                  <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={() => coverRef.current?.click()} disabled={coverUploading} className={btnSmClass} style={btnStyle('sec', C)}>
                      {coverUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                      {coverUploading ? 'Uploading...' : coverImage ? 'Change' : 'Upload'}
                    </button>
                    <button type="button" onClick={() => setShowCoverLibrary(true)} className={btnSmClass} style={btnStyle('sec', C)}>Browse library</button>
                    {coverImage && <button type="button" onClick={() => setCoverImage('')} className={btnSmClass} style={btnStyle('danger', C)}>Remove</button>}
                  </div>
                </div>
                <input type="text" value={coverImage} onChange={e => setCoverImage(e.target.value)} aria-label="Cover image link"
                  placeholder="Or paste an image link" className={`${FIELD} mt-2`} style={field}/>
              </div>
              {showCoverLibrary && (
                <ImageLibrary uploadFolder="covers" initialFolder="covers" returnPublicId onSelect={ref => setCoverImage(ref)} onClose={() => setShowCoverLibrary(false)}/>
              )}
            </Sect>
          )}

          {/* -- Content: an older AI-review or virtual experience assignment's own settings --- */}
          {activeStudioTab === 'content' && assignmentType !== 'standard' && (
            <Sect title={assignmentType === 'virtual_experience' ? 'Virtual experience' : 'AI review settings'} first C={C}>
              <p className="text-xs -mt-2" style={{ color: C.muted }}>{assignmentType === 'virtual_experience' ? 'The experience learners complete.' : 'The rubric, context and score used for the automated review.'}</p>
              {assignmentType === 'virtual_experience' ? (
                veForms.length === 0
                  ? <p className="text-sm" style={{ color: C.muted }}>No virtual experiences yet. Create one from the dashboard first.</p>
                  : <MenuSelect label="Virtual experience" field searchable value={veFormId} onChange={setVeFormId} C={C} placeholder="Select a virtual experience"
                      options={veForms.map(f => ({ value: f.id, label: f.title }))}/>
              ) : (
                <>
                  <div>
                    <span className={labelCls} style={{ color: C.muted }}>Grading rubric</span>
                    <div className="mb-2.5">
                      <RubricFileImportActions busy={extracting} background={C.card} color={C.muted} onSelect={handleExtractRubric}/>
                    </div>
                    <p className="text-xs mb-2" style={{ color: C.muted }}>Upload completed work or your own rubric file to set the criteria.</p>
                    <textarea value={rubricText} onChange={e => setRubricText(e.target.value)} rows={5}
                      placeholder={'One criterion per line\nCode follows DRY principles\nQueries are optimised'} className={FIELD} style={field}/>
                    <p className="text-xs mt-2" style={{ color: C.muted }}>Each line is a separate criterion the AI grades against.</p>
                  </div>
                  {assignmentType === 'document_review' && (
                    <div>
                      <span className={labelCls} style={{ color: C.muted }}>Report scope or context (optional)</span>
                      <textarea value={context} onChange={e => setContext(e.target.value)} rows={4}
                        placeholder="What the report should cover: the market, industry or company the AI should use when reviewing." className={FIELD} style={field}/>
                    </div>
                  )}
                  {(assignmentType === 'code_review' || assignmentType === 'excel_review' || assignmentType === 'document_review') && (
                    <div>
                      <span className={labelCls} style={{ color: C.muted }}>Minimum pass score (out of 100)</span>
                      <input type="number" min={1} max={100} value={minScore} onChange={e => setMinScore(Number(e.target.value))} className={FIELD} style={{ ...field, width: 120 }}/>
                    </div>
                  )}
                  {assignmentType === 'code_review' && (
                    <div>
                      <span className={labelCls} style={{ color: C.muted }}>Database schema (optional, for SQL review)</span>
                      <textarea value={schema} onChange={e => setSchema(e.target.value)} rows={4} placeholder="CREATE TABLE orders (id INT, ...);" className={`${FIELD} font-mono text-xs`} style={field}/>
                    </div>
                  )}
                  {assignmentType === 'excel_review' && (
                    <>
                      <div>
                        <span className={labelCls} style={{ color: C.muted }}>Business context (optional)</span>
                        <textarea value={context} onChange={e => setContext(e.target.value)} rows={4}
                          placeholder="The business scenario or rules the AI should apply when reviewing the spreadsheet." className={FIELD} style={field}/>
                      </div>
                      <div>
                        <span className={labelCls} style={{ color: C.muted }}>Worksheets to evaluate (optional, one per line)</span>
                        <textarea value={reviewSheetNamesText} onChange={e => setReviewSheetNamesText(e.target.value)} rows={3}
                          placeholder={'Revenue Forecast\nSummary Dashboard'} className={`${FIELD} font-mono text-xs`} style={field}/>
                        <p className="text-xs mt-2" style={{ color: C.muted }}>Only these worksheets go to the AI reviewer. Letter case does not matter.</p>
                      </div>
                    </>
                  )}
                </>
              )}
            </Sect>
          )}

          {/* -- Content: overview or learner brief --- */}
          {activeStudioTab === 'content' && showContentFields && (
            <Sect title={assignmentType === 'standard' ? 'Overview' : 'Learner brief'} first={assignmentType === 'standard'} C={C}>
              <p className="text-xs -mt-2" style={{ color: C.muted }}>
                {assignmentType === 'standard' ? 'Optional. Shown above the scenarios.' : `Shown to learners as a briefing before they use the ${LEGACY_TYPE_LABELS[assignmentType] ?? assignmentType} tool.`}
              </p>
              {assignmentType === 'standard' ? (
                <LessonEditor doc={introDoc} bodyFallback={introBody} onChange={({ doc, body }) => { setIntroDoc(doc); setIntroBody(body); }}
                  placeholder="Set the overall context. Add images, steps, callouts, tables." isDark={isDark} accentColor={C.cta}/>
              ) : (
                [
                  { label: 'Scenario', value: scenario, setter: setScenario, placeholder: 'Describe the background context.' },
                  { label: 'Brief', value: brief, setter: setBrief, placeholder: 'Summarise the assignment.' },
                  { label: 'Tasks', value: tasks, setter: setTasks, placeholder: 'List the tasks learners must complete.' },
                  { label: 'Requirements', value: requirements, setter: setRequirements, placeholder: 'List any requirements or constraints.' },
                ].map(({ label, value, setter, placeholder }) => (
                  <div key={label}>
                    <span className={labelCls} style={{ color: C.muted }}>{label}</span>
                    <RichTextEditor value={value} onChange={setter} placeholder={placeholder} enableAiAssist/>
                  </div>
                ))
              )}
            </Sect>
          )}

          {/* -- Content: scenarios and tasks (standard only) --- */}
          {activeStudioTab === 'content' && assignmentType === 'standard' && (
            <div className="p-5" style={{ borderTop: `1px solid ${C.divider}` }}>
              <ScenariosEditor scenarios={scenarios} onChange={setScenarios} C={C} embedded/>
            </div>
          )}

          {/* -- Resources --- */}
          {activeStudioTab === 'resources' && (
            <>
              <Sect title="Resources" first C={C} action={
                <button type="button" onClick={addResource} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5"/>Add resource</button>
              }>
                <p className="text-xs -mt-2" style={{ color: C.muted }}>Links or files learners use while they work.</p>
                {resources.length === 0 ? (
                  <p className="text-sm py-2" style={{ color: C.muted }}>No resources yet.</p>
                ) : (
                  <div>
                    {resources.map((resource, idx) => (
                      <div key={resource.id} className="flex flex-wrap items-center gap-2.5 py-2.5" style={idx ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <input type="text" placeholder="Resource name" value={resource.name} aria-label="Resource name"
                          onChange={e => updateResource(resource.id, 'name', sanitizePlainText(e.target.value))}
                          className={`${FIELD} flex-1 basis-[160px] min-w-0`} style={field} maxLength={200}/>
                        <input type="url" placeholder={resource.resource_type === 'file' ? 'Upload a file or paste a link' : 'https://'} value={resource.url} aria-label="Resource link"
                          onChange={e => updateResource(resource.id, 'url', e.target.value)}
                          className={`${FIELD} flex-[1.3] basis-[180px] min-w-0`} style={field}/>
                        <div className="inline-flex gap-0.5 p-0.5 rounded-full flex-shrink-0" style={{ boxShadow: `inset 0 0 0 1px ${C.divider}` }} role="group" aria-label="Resource type">
                          {(['link', 'file'] as const).map(t => (
                            <button key={t} type="button" aria-pressed={resource.resource_type === t} onClick={() => updateResource(resource.id, 'resource_type', t)}
                              className="h-6 px-2.5 rounded-full text-[11px] font-semibold" style={chip(resource.resource_type === t)}>
                              {t === 'link' ? 'Link' : 'File'}
                            </button>
                          ))}
                        </div>
                        {resource.resource_type === 'file' && (
                          <>
                            <input type="file" className="hidden" ref={el => { resourceFileRefs.current[resource.id] = el; }} onChange={e => handleResourceFileUpload(resource.id, e)}/>
                            <button type="button" onClick={() => resourceFileRefs.current[resource.id]?.click()} disabled={resourceUploading[resource.id]} className={btnSmClass} style={btnStyle('sec', C)}>
                              {resourceUploading[resource.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                              {resourceUploading[resource.id] ? 'Uploading...' : 'Upload'}
                            </button>
                          </>
                        )}
                        {removeBtn(() => removeResource(resource.id), 'Remove resource')}
                      </div>
                    ))}
                  </div>
                )}
              </Sect>

              <Sect title="Solution files" C={C} action={
                <div className="flex flex-wrap gap-2">
                  <input type="file" multiple className="hidden" ref={solutionFileRef} accept={[...ALLOWED_SOLUTION_EXTENSIONS].join(',')} onChange={handleSolutionFileUpload}/>
                  <button type="button" onClick={addSolutionLink} className={btnSmClass} style={btnStyle('sec', C)}><LinkIcon className="w-3.5 h-3.5"/>Add link</button>
                  <button type="button" onClick={() => solutionFileRef.current?.click()} disabled={solutionUploading} className={btnSmClass} style={btnStyle('sec', C)}>
                    {solutionUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                    {solutionUploading ? 'Uploading...' : 'Upload files'}
                  </button>
                </div>
              }>
                <p className="text-xs -mt-2" style={{ color: C.muted }}>The model answer. A learner sees it only after their own work is graded.</p>
                {solutions.length === 0 ? (
                  <p className="text-sm py-2" style={{ color: C.muted }}>No solution files yet.</p>
                ) : (
                  <div>
                    {solutions.map((s, idx) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-2.5 py-2.5" style={idx ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <input type="text" placeholder="Solution name" value={s.name} aria-label="Solution name"
                          onChange={e => updateSolution(s.id, 'name', sanitizePlainText(e.target.value))}
                          className={`${FIELD} flex-1 basis-[160px] min-w-0`} style={field} maxLength={200}/>
                        {s.kind === 'link' && (
                          <input type="url" placeholder="https://" value={s.url ?? ''} aria-label="Solution link" onChange={e => updateSolution(s.id, 'url', e.target.value)}
                            className={`${FIELD} flex-[1.3] basis-[180px] min-w-0`} style={field}/>
                        )}
                        <Pill tone="mute" C={C}>{s.kind === 'file' ? 'Private file' : 'Link'}</Pill>
                        {removeBtn(() => removeSolution(s.id), 'Remove solution')}
                      </div>
                    ))}
                  </div>
                )}
              </Sect>
            </>
          )}

          {/* -- Settings --- */}
          {activeStudioTab === 'settings' && (
            <>
              <Sect title="Course and timing" first C={C}>
                <div>
                  <span className={labelCls} style={{ color: C.muted }}>Related course</span>
                  <MenuSelect label="Related course" field searchable value={relatedCourse} onChange={setRelatedCourse} C={C}
                    options={[{ value: '', label: 'None' }, ...courses.map(c => ({ value: c.id, label: c.title }))]}/>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className={labelCls} style={{ color: C.muted }}>Deadline</span>
                    <DateField label="Deadline" placeholder="No deadline" value={deadlineDate} onChange={setDeadlineDate} C={C}/>
                    <p className="text-xs mt-2" style={{ color: C.muted }}>Learners see a countdown until this date.</p>
                  </div>
                  <div>
                    <label htmlFor="asg-pass" className={labelCls} style={{ color: C.muted }}>Pass mark</label>
                    <div className="flex items-center gap-2">
                      <input id="asg-pass" type="number" min={1} max={100} value={passingScore}
                        onChange={e => setPassingScore(Math.min(100, Math.max(1, Math.round(Number(e.target.value) || DEFAULT_PASS_MARK))))}
                        className={FIELD} style={{ ...field, width: 110 }}/>
                      <span className="text-sm" style={{ color: C.muted }}>/ 100</span>
                    </div>
                    <p className="text-xs mt-2" style={{ color: C.muted }}>
                      Below it the learner can resubmit; at or above it the work passes{assignmentType === 'standard' ? ' and solution files are released' : ''}. Defaults to {DEFAULT_PASS_MARK}.
                    </p>
                  </div>
                </div>
                {/* Submission instructions are retired from the Standard flow. Shown only when an older
                    assignment already has some, so editing does not silently drop them. */}
                {submissionInstructions.trim() !== '' && (
                  <div>
                    <span className={labelCls} style={{ color: C.muted }}>Submission instructions (older field, not shown to learners)</span>
                    <RichTextEditor value={submissionInstructions} onChange={setSubmissionInstructions} placeholder="How should learners submit their work?" enableAiAssist/>
                  </div>
                )}
              </Sect>

              <Sect title="Who gets it" aside={audienceMode === 'cohorts' ? plural(selectedCohortIds.length, 'cohort') : plural(selectedGroupIds.length, 'group')} C={C}>
                <div className="inline-flex gap-1 p-1 rounded-xl w-fit" style={{ background: C.page }} role="group" aria-label="Give it to">
                  {(['cohorts', 'groups'] as const).map(mode => (
                    <button key={mode} type="button" aria-pressed={audienceMode === mode} onClick={() => setAudienceMode(mode)}
                      className="h-8 px-3.5 rounded-[9px] text-[13px] font-semibold" style={chip(audienceMode === mode)}>
                      {mode === 'cohorts' ? 'Cohorts' : 'Groups'}
                    </button>
                  ))}
                </div>
                {audienceMode === 'cohorts' && (
                  cohorts.length === 0
                    ? <p className="text-sm" style={{ color: C.muted }}>No cohorts yet.</p>
                    : <div>
                        {cohorts.map((c, idx) => (
                          <button key={c.id} type="button" role="checkbox" aria-checked={selectedCohortIds.includes(c.id)} onClick={() => toggleCohort(c.id)}
                            className="w-full flex items-center gap-3 px-1 py-3 text-left text-sm font-semibold" style={{ color: C.text, borderTop: idx ? `1px solid ${C.divider}` : undefined }}>
                            <Tick on={selectedCohortIds.includes(c.id)} C={C}/>{c.name}
                          </button>
                        ))}
                      </div>
                )}
                {audienceMode === 'groups' && (
                  groups.length === 0
                    ? <p className="text-sm" style={{ color: C.muted }}>No groups yet. Create groups on the <Link href="/admin/groups" className="font-semibold underline" style={{ color: C.text }}>Groups page</Link>.</p>
                    : <div>
                        {groups.map((g, idx) => {
                          const cohortName = cohorts.find(c => c.id === g.cohort_id)?.name;
                          return (
                            <button key={g.id} type="button" role="checkbox" aria-checked={selectedGroupIds.includes(g.id)} onClick={() => toggleGroup(g.id)}
                              className="w-full flex items-center gap-3 px-1 py-3 text-left" style={{ borderTop: idx ? `1px solid ${C.divider}` : undefined }}>
                              <Tick on={selectedGroupIds.includes(g.id)} C={C}/>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold" style={{ color: C.text }}>{g.name}</span>
                                {cohortName && <span className="block text-xs" style={{ color: C.muted }}>{cohortName}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                )}
              </Sect>

              <Sect title="Status" C={C}>
                <div role="radiogroup" aria-label="Status" className="grid gap-3 sm:grid-cols-2">
                  {choice(status === 'draft', () => setStatus('draft'), 'Draft', 'A private working version')}
                  {choice(status === 'published', () => setStatus('published'), 'Published', 'Visible to the learners it is given to')}
                </div>
              </Sect>
            </>
          )}

        </Card>
        </form>
      </main>

      {/* Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: C.page }}
          >
            {/* Learner preview chrome -- the assignment body below uses the real student renderer. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 20px', background: C.card, borderBottom: `1px solid ${C.cardBorder}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }} aria-hidden="true">
                  <span className="animate-ping" style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: C.cta, opacity: .2 }}/>
                  <span style={{ position: 'relative', width: 6, height: 6, borderRadius: '50%', background: C.cta }}/>
                </span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 750, color: C.text, margin: 0 }}>Student preview</p>
                  <p style={{ fontSize: 11, color: C.faint, margin: '2px 0 0' }}>Rendered with the learner experience. Preview activity is not saved.</p>
                </div>
              </div>
              <button onClick={() => setShowPreview(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <X style={{ width: 12, height: 12 }}/> Exit Preview
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 18px 48px' }}>
              {/* VE-type: show AssignmentExperiencePlayer */}
              {assignmentType === 'virtual_experience' && previewVeConfig && (
                <AssignmentExperiencePlayer
                  formId={veFormId || 'preview'}
                  config={previewVeConfig}
                  userId="preview"
                  studentName="Instructor Preview"
                  studentEmail="preview@instructor"
                  sessionToken=""
                  isDark={C.page === DARK_C.page}
                  onComplete={() => {}}
                  previewMode={true}
                />
              )}

              {assignmentType === 'virtual_experience' && !previewVeConfig && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: C.faint, fontSize: 14 }}>
                  {veFormId ? 'Could not load Virtual Experience config.' : 'Select a Virtual Experience to preview it.'}
                </div>
              )}

              {/* Standard with scenarios: show the real plain player in preview mode */}
              {assignmentType === 'standard' && scenarios.length > 0 && (
                <div style={{ maxWidth: 1180, margin: '0 auto' }}>
                  <StandardAssignmentPlayer
                    assignmentId={editId || 'preview'}
                    config={{ scenarios, introDoc, introBody }}
                    userId="preview"
                    previewMode
                    title={title || 'Untitled Assignment'}
                    coverImage={coverImage}
                    deadline={deadlineDate}
                    courseTitle={courses.find(c => c.id === relatedCourse)?.title}
                    resources={resources.filter(r => r.url.trim()).map(r => ({ id: r.id, name: r.name, url: r.url, resource_type: r.resource_type }))}
                  />
                </div>
              )}

              {/* Non-VE types (legacy AI + empty standard): show assignment content */}
              {assignmentType !== 'virtual_experience' && !(assignmentType === 'standard' && scenarios.length > 0) && (
                <div style={{ maxWidth: 900, margin: '0 auto' }}>
                  <div style={{ borderRadius: 20, overflow: 'hidden', background: C.card, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, marginBottom: 16 }}>
                    {coverImage && (
                      <div style={{ padding: '16px 16px 0' }}>
                        <img src={resolveCoverUrl(coverImage)} alt={title} style={{ width: '100%', objectFit: 'cover', borderRadius: 12, maxHeight: 220 }} onError={e => (e.target as HTMLImageElement).style.display = 'none'}/>
                      </div>
                    )}
                    <div style={{ padding: '20px 24px' }}>
                      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{title || 'Untitled Assignment'}</h2>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: C.lime, color: C.cta }}>
                        {ASSIGNMENT_TYPES.find(t => t.value === assignmentType)?.label}
                      </span>
                    </div>
                    {scenario && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Scenario</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(scenario) }}/>
                        </div>
                      </>
                    )}
                    {brief && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Brief</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(brief) }}/>
                        </div>
                      </>
                    )}
                    {tasks && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Tasks</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(tasks) }}/>
                        </div>
                      </>
                    )}
                    {requirements && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Requirements</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(requirements) }}/>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Submission area placeholder */}
                  <div style={{ borderRadius: 20, background: C.card, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, padding: 24 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '0 0 6px' }}>Submission workspace</p>
                    <p style={{ fontSize: 16, fontWeight: 750, color: C.text, marginBottom: 14, marginTop: 0 }}>Your submission</p>
                    {assignmentType === 'standard' && (
                      <>
                        <div style={{ height: 80, borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input, marginBottom: 12 }}/>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ height: 36, flex: 1, borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input }}/>
                          <div style={{ height: 36, flex: 1, borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input }}/>
                        </div>
                      </>
                    )}
                    {assignmentType !== 'standard' && (
                      <p style={{ fontSize: 14, color: C.faint, margin: 0 }}>
                        {assignmentType === 'code_review' && 'Students paste their SQL / code here and get AI feedback.'}
                        {assignmentType === 'excel_review' && 'Students upload their spreadsheet and get AI feedback.'}
                        {assignmentType === 'dashboard_critique' && 'Students upload a dashboard screenshot and get AI critique.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
