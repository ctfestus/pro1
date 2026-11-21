'use client';

// The book editor at /create/product (new) and /create/product?id= (edit). Uses the dashboard theme
// and kit, like the other editors. Every save goes through /api/books, which re-checks
// ownership, uploaded files and publish readiness; this page only helps
// the author get there.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, Download, ExternalLink, Eye, FileText, ImagePlus, ListOrdered, Loader2, Plus, RefreshCw,
  Trash2, Upload, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DARK_C, useC, type ThemeColors } from '@/lib/theme';
import { labelCls } from '@/components/create/shared';
import { MenuSelect } from '@/components/MenuSelect';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { FIELD } from '@/components/dashboard/subscriptions/Modal';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { ImageLibrary } from '@/components/ImageLibrary';
import { RichTextEditor } from '@/components/RichTextEditor';
import { descriptionHtml } from '@/lib/books/description';
import { formatLabel, opensInBrowser } from '@/lib/books/format';
import { normalizeProductAddress, PRODUCT_ADDRESS, PRODUCT_TYPE_NAMES, PRODUCT_TYPES } from '@/lib/books/product-type';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import {
  BOOK_DIFFICULTIES,
  BOOK_FILE_MAX_BYTES,
  BOOK_HTML_MAX_BYTES,
  BOOK_LICENSE_TYPES,
  DEFAULT_SAMPLE_CHAPTERS,
  DEFAULT_SAMPLE_PAGES,
  isReadableFormat,
  normalizeProductLink,
  parseSampleSpec,
  sampleStorePath,
  type BookFormat,
  type BookLicenseType,
  type BookSampleSpec,
  type BookStatus,
} from '@/lib/books/schema';
import {
  chaptersFromEpub, chaptersFromHtml, epubOutline, externalReferencesInHtml, htmlOutline,
  type OutlineEntry, type SuggestedChapter,
} from '@/lib/books/chapters';
import { chaptersFromPicks, cutPdfSample, pdfChapters, pdfOutline } from '@/lib/books/pdf';
import { cutEpubSample, cutHtmlSample, type SampleFinding } from '@/lib/books/sample';
import { openBookPreview } from '@/lib/books/open-preview';
import { DateField } from '@/components/DatePicker';

const LICENSE_LABELS: Record<BookLicenseType, string> = {
  own: 'Our own work',
  cc_by: 'Creative Commons BY',
  cc_by_sa: 'Creative Commons BY-SA',
  cc_by_nc: 'Creative Commons BY-NC',
  public_domain: 'Public domain',
  licensed: 'Licensed from a publisher',
  other: 'Other',
};

const FORMAT_BY_EXTENSION: Record<string, BookFormat> = {
  epub: 'epub', pdf: 'pdf', html: 'html', htm: 'html',
  // Download-only files (migration 243): no chapters, no cut sample, never shown in the browser.
  zip: 'zip', xlsx: 'xlsx', docx: 'docx', pptx: 'pptx', csv: 'csv', txt: 'txt', md: 'md',
};
const FILE_ACCEPT = '.epub,.pdf,.html,.htm,.zip,.xlsx,.docx,.pptx,.csv,.txt,.md';

type ChapterDraft = {
  key: string;
  id?: string;
  title: string;
  href: string;
  anchor: string;
  pageStart: string;
  pageEnd: string;
  estimatedMinutes: number | null;
  required: boolean;
  isPreview: boolean;
};

type UploadedFile = { path: string; name: string; size: number };

type EditorState = {
  title: string;
  subtitle: string;
  description: string;
  coverImage: string;
  authors: string;
  category: string;
  topics: string;
  skills: string;
  difficulty: string;
  estimatedMinutes: string;
  rightsHolder: string;
  licenseType: string;
  licenseUrl: string;
  licenseExpiresAt: string;
  aiAllowed: boolean;
  endorsementPermitted: boolean;
  availableToEveryone: boolean;
  cohortIds: string[];
  /** Courses this product is recommended with (migration 240). */
  recommendedCourseIds: string[];
  /** What kind of product (migration 242), and the author's own word when it is "other". */
  productType: string;
  productTypeLabel: string;
  purchasable: boolean;
  royaltyPct: string;
  // saleAmount and saleEndsAt (a date, yyyy-mm-dd) are optional: a sale price shown with the
  // regular price crossed out, until the end of that day.
  prices: { currency: string; amount: string; saleAmount: string; saleEndsAt: string }[];
};

const EMPTY: EditorState = {
  title: '', subtitle: '', description: '', coverImage: '', authors: '', category: '', topics: '', skills: '',
  difficulty: '', estimatedMinutes: '', rightsHolder: '', licenseType: '', licenseUrl: '', licenseExpiresAt: '',
  aiAllowed: true, endorsementPermitted: false, availableToEveryone: false, cohortIds: [], recommendedCourseIds: [], productType: 'book', productTypeLabel: '',
  purchasable: false, royaltyPct: '0', prices: [],
};

type SampleSource = 'cut' | 'upload';

/** A sample cut in the browser, before upload: its bytes, what to review, and what it was cut from. */
type CutSample = {
  blob: Blob;
  html?: string;
  findings: SampleFinding[];
  /** Format, settings and stopping point it was cut with: a review only applies to the same cut. */
  key: string;
};

const splitList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean);
/** A timestamp as the author's local date (yyyy-mm-dd), for a date input. */
function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const wholeNumber = (v: string) => (/^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null);
const newKey = () => Math.random().toString(36).slice(2, 10);

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function formatOf(file: File): BookFormat | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return FORMAT_BY_EXTENSION[ext] ?? null;
}

function sizeLabel(bytes: number | null | undefined): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function chapterFromRow(row: any): ChapterDraft {
  const loc = row?.locator ?? {};
  return {
    key: newKey(),
    id: row.id,
    title: row.title ?? '',
    href: loc.href ?? '',
    anchor: loc.anchor ?? '',
    pageStart: loc.pageStart ? String(loc.pageStart) : '',
    pageEnd: loc.pageEnd ? String(loc.pageEnd) : '',
    estimatedMinutes: row.estimated_minutes ?? null,
    required: row.required !== false,
    isPreview: row.is_preview === true,
  };
}

type BookTab = 'details' | 'file' | 'rights' | 'access' | 'selling';
const BOOK_TABS: { id: BookTab; label: string }[] = [
  { id: 'details', label: 'Details' }, { id: 'file', label: 'File' }, { id: 'rights', label: 'Rights' },
  { id: 'access', label: 'Access' }, { id: 'selling', label: 'Selling' },
];

// One flat section of the step card: a sentence-case heading, an optional count or action, then the fields.
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

function SwitchRow({ C, title, sub, on, onChange }: { C: ThemeColors; title: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: C.muted }}>{sub}</p>}
      </div>
      <Switch on={on} onChange={onChange} label={title} C={C} />
    </div>
  );
}

export function BookEditor() {
  const theme = useC();
  // The dashboard theme with the shared blue for buttons and selection controls, like the other editors.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [tab, setTab] = useState<BookTab>('details');
  const router = useRouter();
  const editId = useSearchParams().get('id');

  const [state, setState] = useState<EditorState>(EMPTY);
  const [status, setStatus] = useState<BookStatus>('draft');
  const [format, setFormat] = useState<BookFormat | null>(null);
  // How the product is delivered: an uploaded file, or a link (migration 243). The address is read
  // back from book_links, which only the product's author or an admin can read.
  const [delivery, setDelivery] = useState<'file' | 'link'>('file');
  const [linkDraft, setLinkDraft] = useState('');
  const [storedLink, setStoredLink] = useState<string | null>(null);
  // For the sample's links back to the book's store page.
  const [slug, setSlug] = useState('');
  // The web address being edited (/products/<address>), saved on its own (PATCH /api/books/address).
  const [addressDraft, setAddressDraft] = useState('');
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressNote, setAddressNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [storedFile, setStoredFile] = useState<{ path: string | null; size: number | null }>({ path: null, size: null });
  const [storedPreview, setStoredPreview] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<UploadedFile | null>(null);
  const [newFormat, setNewFormat] = useState<BookFormat | null>(null);
  const [preview, setPreview] = useState<UploadedFile | null | 'remove'>(null);
  const [chapters, setChaptersRaw] = useState<ChapterDraft[]>([]);
  // Chapters and prices are only sent when the author changed them, so a save can never replace
  // them with a list that merely failed to load.
  const [chaptersDirty, setChaptersDirty] = useState(false);
  const [pricesDirty, setPricesDirty] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const setChapters = useCallback((next: ChapterDraft[] | ((prev: ChapterDraft[]) => ChapterDraft[])) => {
    setChaptersRaw(next);
    setChaptersDirty(true);
  }, []);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  // Courses the product can be recommended with: an instructor's own, or every course for an admin
  // (the server enforces the same rule on save).
  const [courses, setCourses] = useState<{ id: string; title: string; status: string }[]>([]);
  const [courseQuery, setCourseQuery] = useState('');
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState<null | BookStatus>(null);
  const [uploading, setUploading] = useState<null | 'file' | 'preview'>(null);
  const [opening, setOpening] = useState<null | 'full' | 'sample'>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [coverOpen, setCoverOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [findingChapters, setFindingChapters] = useState(false);
  // A cut sample with findings waits here for the author's review instead of being used. The
  // author previews it and confirms; then exactly this sample is uploaded on the next save.
  const [sampleReview, setSampleReview] = useState<CutSample | null>(null);
  const [reviewAck, setReviewAck] = useState(false);
  const [reviewPreview, setReviewPreview] = useState(false);
  const acceptedSample = useRef<CutSample | null>(null);
  // Anything that changes what the sample is cut from or how: the next save cuts afresh, and a
  // review waiting for a different cut no longer applies.
  const sampleChanged = useCallback(() => {
    setSampleDirty(true);
    setSampleReview(null);
    setReviewAck(false);
    setReviewPreview(false);
    acceptedSample.current = null;
  }, []);
  // The free sample: cut from the book on save (the default), or a file the author uploads.
  const [sampleSource, setSampleSource] = useState<SampleSource>('cut');
  const [samplePages, setSamplePages] = useState({ from: String(DEFAULT_SAMPLE_PAGES.from), to: String(DEFAULT_SAMPLE_PAGES.to) });
  const [sampleChapters, setSampleChapters] = useState(String(DEFAULT_SAMPLE_CHAPTERS));
  // True when the next save must cut the sample again (settings or the book file changed).
  const [sampleDirty, setSampleDirty] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  // The book's bytes, kept after an upload (or fetched once) for finding chapters and cutting samples.
  const bookData = useRef<{ blob: Blob; format: BookFormat } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewInput = useRef<HTMLInputElement>(null);

  const update = useCallback((patch: Partial<EditorState>) => setState(prev => ({ ...prev, ...patch })), []);
  const updatePrices = useCallback((prices: EditorState['prices']) => {
    setState(prev => ({ ...prev, prices }));
    setPricesDirty(true);
  }, []);
  const effectiveFormat = newFormat ?? format;

  useEffect(() => {
    supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name')
      .then(({ data }) => setCohorts(data ?? []));
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data: me } = await supabase.from('students').select('role').eq('id', uid).maybeSingle();
      let q = supabase.from('courses').select('id, title, status').neq('status', 'archived').order('title').limit(1000);
      if (me?.role !== 'admin') q = q.eq('user_id', uid);
      const { data } = await q;
      setCourses((data ?? []) as { id: string; title: string; status: string }[]);
    })();
  }, []);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      const [{ data: book, error: bookError }, { data: chapterRows, error: chapterError }, { data: priceRows, error: priceError }] = await Promise.all([
        supabase.from('books').select('*').eq('id', editId).maybeSingle(),
        supabase.from('book_chapters').select('*').eq('book_id', editId).order('position'),
        supabase.from('book_prices').select('currency, amount, sale_amount, sale_ends_at').eq('book_id', editId).order('currency'),
      ]);
      if (cancelled) return;
      if (bookError || !book || chapterError || priceError) {
        setError('This product could not be loaded completely. Reload the page before editing.');
        setBlocked(true);
        setLoading(false);
        return;
      }
      setState({
        title: book.title ?? '', subtitle: book.subtitle ?? '', description: descriptionHtml(book.description),
        coverImage: book.cover_image ?? '', authors: (book.authors ?? []).join(', '), category: book.category ?? '',
        topics: (book.topics ?? []).join(', '), skills: (book.skills ?? []).join(', '),
        difficulty: book.difficulty ?? '', estimatedMinutes: book.estimated_minutes ? String(book.estimated_minutes) : '',
        rightsHolder: book.rights_holder ?? '', licenseType: book.license_type ?? '', licenseUrl: book.license_url ?? '',
        licenseExpiresAt: book.license_expires_at ? String(book.license_expires_at).slice(0, 10) : '',
        aiAllowed: book.ai_allowed !== false, endorsementPermitted: book.endorsement_permitted === true,
        availableToEveryone: book.available_to_everyone === true, cohortIds: book.cohort_ids ?? [],
        recommendedCourseIds: Array.isArray(book.recommended_course_ids) ? book.recommended_course_ids : [],
        productType: typeof book.product_type === 'string' ? book.product_type : 'book',
        productTypeLabel: book.product_type_label ?? '',
        purchasable: book.purchasable === true, royaltyPct: String(book.royalty_pct ?? 0),
        prices: (priceRows ?? []).map((p: any) => ({
          currency: p.currency,
          amount: String(p.amount),
          saleAmount: p.sale_amount == null ? '' : String(p.sale_amount),
          saleEndsAt: p.sale_ends_at ? localDate(p.sale_ends_at) : '',
        })),
      });
      setStatus(book.status);
      setFormat(book.format ?? null);
      setDelivery(book.format === 'link' ? 'link' : 'file');
      if (book.format === 'link') {
        const { data: linkRow, error: linkError } = await supabase.from('book_links').select('url').eq('book_id', editId).maybeSingle();
        if (cancelled) return;
        if (linkError) {
          setError('The product link could not be loaded. Reload the page before editing.');
          setBlocked(true);
        }
        setStoredLink(linkRow?.url ?? null);
        setLinkDraft(linkRow?.url ?? '');
      }
      setSlug(book.slug ?? '');
      setAddressDraft(book.slug ?? '');
      setStoredFile({ path: book.file_path ?? null, size: book.file_size ?? null });
      setStoredPreview(book.preview_file_path ?? null);
      setChaptersRaw((chapterRows ?? []).map(chapterFromRow));
      setChaptersDirty(false);
      setPricesDirty(false);
      // A sample cut from the book records how; an uploaded one does not. A book with a file but no
      // sample at all gets the default cut on its next save.
      const spec = parseSampleSpec(book.sample_spec);
      if (spec && 'pages' in spec) setSamplePages({ from: String(spec.pages.from), to: String(spec.pages.to) });
      if (spec && 'chapters' in spec) setSampleChapters(String(spec.chapters));
      // Only the formats the platform can read can have a sample cut from them; any other file can
      // only have one uploaded.
      setSampleSource(isReadableFormat(book.format) && (spec || !book.preview_file_path) ? 'cut' : 'upload');
      // A chapter cut whose links lead to an older store address (or none recorded) is made again
      // on the next save, so its links reach the product page.
      const staleLinks = !!spec && 'chapters' in spec && !!book.file_path && !!book.slug && spec.storePath !== sampleStorePath(book.slug);
      setSampleDirty(isReadableFormat(book.format) && ((!spec && !book.preview_file_path && !!book.file_path) || staleLinks));
      setLoadedAt(book.updated_at ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [editId]);

  async function createDraft() {
    setError('');
    if (!newTitle.trim()) { setError('Add a title.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not create the product.');
      router.replace(`/create/product?id=${d.id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not create the product.');
      setCreating(false);
    }
  }

  // Opens the saved file (or sample) in a new tab, as the server stores it. Unsaved uploads are not
  // previewable: the routes only serve the paths saved on the book.
  async function previewSaved(variant: 'full' | 'sample') {
    if (!editId || !format) return;
    setError(''); setOpening(variant);
    try {
      await openBookPreview(editId, format, variant);
    } catch (e: any) {
      setError(e?.message || 'Could not open the preview.');
    } finally {
      setOpening(null);
    }
  }

  // Upload bytes through the book's signed upload, as the sample or the book file.
  async function putObject(kind: 'file' | 'preview', fmt: BookFormat, blob: Blob, name: string): Promise<UploadedFile> {
    const res = await fetch('/api/books/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ bookId: editId, kind, format: fmt, size: blob.size }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not prepare the upload.');
    const typed = new File([blob], name, { type: d.contentType });
    const up = await supabase.storage.from(d.bucket).uploadToSignedUrl(d.path, d.uploadToken, typed);
    if (up.error) throw new Error(up.error.message || 'Upload failed.');
    return { path: d.path, name, size: blob.size };
  }

  async function upload(kind: 'file' | 'preview', file: File) {
    if (!editId) return;
    setError(''); setNotice('');
    const fmt = formatOf(file);
    if (!fmt) { setError('Choose a PDF, EPUB, HTML, ZIP, Excel, Word, PowerPoint, CSV, text or Markdown file.'); return; }
    if (kind === 'preview' && fmt !== effectiveFormat) { setError(`The sample must be the same format as the product file (${effectiveFormat?.toUpperCase()}).`); return; }
    const max = fmt === 'html' ? BOOK_HTML_MAX_BYTES : BOOK_FILE_MAX_BYTES;
    if (file.size > max) { setError(`The file must be under ${Math.round(max / (1024 * 1024))} MB.`); return; }

    if (fmt === 'html') {
      const external = externalReferencesInHtml(await file.text());
      if (external.length) {
        const ok = window.confirm(`This HTML file loads ${external.length} file(s) from other sites, for example ${external[0]}. A product file should be self-contained, so it keeps working and cannot change after you publish it. Upload anyway?`);
        if (!ok) return;
      }
    }

    setUploading(kind);
    try {
      const uploaded = await putObject(kind, fmt, file, file.name);
      if (kind === 'preview') {
        setPreview(uploaded);
        setSampleSource('upload');
        setSampleDirty(false);
        setNotice('Uploaded. Save to keep it.');
      } else {
        setNewFile(uploaded);
        setNewFormat(fmt);
        setDelivery('file');
        bookData.current = { blob: file, format: fmt };
        setPageCount(null);
        if (fmt !== format && (storedPreview || preview)) setPreview('remove');
        if (!isReadableFormat(fmt)) {
          // Nothing to cut or read chapters from: a sample can only be uploaded.
          setSampleSource('upload');
          setSampleDirty(false);
          setSampleReview(null);
          setNotice(format === 'link' ? 'Uploaded. Save to use this file instead of the link.' : 'Uploaded. Save to keep it.');
          return;
        }
        // A product moving from a link to a readable file starts with the usual cut sample.
        if (sampleSource === 'cut' || format === 'link') { setSampleSource('cut'); sampleChanged(); }
        else setSampleReview(null);
        setNotice(format === 'link' ? 'Uploaded. Save to use this file instead of the link.' : 'Uploaded. Save to keep it.');
        if (!chapters.length || fmt !== format) await findChapters(fmt, true);
      }
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setUploading(null);
    }
  }

  /** The book's bytes: the file just uploaded, else the saved one (fetched once). */
  async function bookBlob(fmt: BookFormat): Promise<Blob> {
    if (bookData.current?.format === fmt) return bookData.current.blob;
    const res = await fetch(`/api/books/${encodeURIComponent(editId ?? '')}/file`, { headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.url) throw new Error(d.error || 'Could not load the product file.');
    const file = await fetch(d.url);
    if (!file.ok) throw new Error('Could not load the product file.');
    const blob = await file.blob();
    bookData.current = { blob, format: fmt };
    return blob;
  }

  /** AI picks the chapter starts from the book's outline; each maps back to a real location. */
  async function suggestWithAi(fmt: BookFormat, outline: OutlineEntry[], pages: number | null): Promise<SuggestedChapter[]> {
    const res = await fetch('/api/books/suggest-chapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ bookId: editId, format: fmt, outline: outline.map(o => (o.level ? { text: o.text, level: o.level } : { text: o.text })) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Could not suggest chapters.');
    return chaptersFromPicks(fmt, Array.isArray(d.chapters) ? d.chapters : [], outline, pages);
  }

  /**
   * Fill the chapter list from the book: its own table of contents, sections or bookmarks first;
   * when it has none (or only one chapter), AI suggests them from the headings or page text, if the
   * book's rights allow AI. `auto` is the run after an upload, which never asks before replacing.
   */
  async function findChapters(fmt: BookFormat | null = effectiveFormat, auto = false) {
    if (!fmt) return;
    setError(''); setFindingChapters(true);
    try {
      const blob = await bookBlob(fmt);
      let found: SuggestedChapter[] = [];
      let outline: () => Promise<OutlineEntry[]>;
      let pages: number | null = null;
      let weak: boolean;
      if (fmt === 'epub') {
        const r = await chaptersFromEpub(blob);
        found = r.chapters;
        weak = !r.fromToc;
        outline = () => epubOutline(blob);
      } else if (fmt === 'html') {
        const html = await blob.text();
        found = chaptersFromHtml(html);
        weak = found.length < 2;
        // Only headings that can be linked to: a chapter needs a place in the file to start (and
        // for the sample to stop) at.
        outline = async () => htmlOutline(html).filter(e => e.locator);
      } else {
        const buffer = await blob.arrayBuffer();
        const r = await pdfChapters(buffer);
        pages = r.pageCount;
        setPageCount(r.pageCount);
        found = r.chapters;
        weak = found.length < 2;
        outline = async () => (await pdfOutline(buffer)).outline;
      }

      let viaAi = false;
      let aiProblem = '';
      if (weak && state.aiAllowed) {
        try {
          const items = await outline();
          if (items.some(i => i.text)) {
            const suggested = await suggestWithAi(fmt, items, pages);
            // An EPUB without a table of contents only had "Section 1, 2..." titles, so AI wins there
            // whenever it found anything; elsewhere it must find more than the structure did.
            if (suggested.length && (fmt === 'epub' || suggested.length > found.length)) { found = suggested; viaAi = true; }
          }
        } catch (e: any) {
          aiProblem = e?.message || 'AI could not suggest chapters.';
        }
      }

      if (!found.length) {
        const why = aiProblem || (!state.aiAllowed ? 'This product\'s rights do not allow AI to read it.' : '');
        setNotice(`No chapters were found in the file.${why ? ` ${why}` : ''} Add them below.`);
        return;
      }
      if (!auto && chapters.length && !window.confirm(`Replace the ${chapters.length} chapter(s) in the editor with the ${found.length} found in the file?`)) return;
      applyChapters(found);
      setNotice(`Found ${found.length} chapter(s)${viaAi ? ' with AI' : ''}. Review them, then save.${aiProblem ? ` (${aiProblem})` : ''}`);
    } catch (e: any) {
      setError(e?.message || 'Could not read chapters from the file.');
    } finally {
      setFindingChapters(false);
    }
  }

  function applyChapters(found: SuggestedChapter[]) {
    // Match by location so a chapter found again keeps its id (and settings).
    const where = (c: { href?: string; anchor?: string; pageStart?: string | number }) => c.href || c.anchor || (c.pageStart ? `p${c.pageStart}` : '');
    const byLocation = new Map(chapters.map(c => [where(c), c]));
    const cutCount = wholeNumber(sampleChapters) ?? 0;
    setChapters(found.map((c, i) => {
      const loc = c.locator as { href?: string; anchor?: string; pageStart?: number; pageEnd?: number };
      const match = byLocation.get(where(loc));
      return {
        key: newKey(), id: match?.id, title: c.title,
        href: loc.href ?? '', anchor: loc.anchor ?? '',
        pageStart: loc.pageStart ? String(loc.pageStart) : '', pageEnd: loc.pageEnd ? String(loc.pageEnd) : '',
        estimatedMinutes: match?.estimatedMinutes ?? null, required: match?.required ?? true,
        isPreview: sampleSource === 'cut' ? i < cutCount : match?.isPreview ?? false,
      };
    }));
  }

  /** The sample spec the editor's settings describe, for the book's format. */
  function currentSampleSpec(fmt: BookFormat): BookSampleSpec | null {
    if (fmt === 'pdf') {
      const from = wholeNumber(samplePages.from);
      const to = wholeNumber(samplePages.to);
      return from && to && to >= from ? { pages: { from, to } } : null;
    }
    const n = wholeNumber(sampleChapters);
    return n ? (slug ? { chapters: n, storePath: sampleStorePath(slug) } : { chapters: n }) : null;
  }

  /** Identifies a cut: format, settings and where it stops. A review applies to that cut only. */
  function sampleKey(fmt: BookFormat, spec: BookSampleSpec): string {
    const stop = 'chapters' in spec ? chapters[spec.chapters] : undefined;
    return JSON.stringify([fmt, spec, stop?.anchor ?? stop?.href ?? '', newFile?.path ?? storedFile.path]);
  }

  /**
   * Cut the free sample out of the book (not uploaded yet). Throws a sentence the author can act on,
   * including SampleRefusedError when the sample would plainly give away the paid chapters.
   */
  async function makeSample(fmt: BookFormat, spec: BookSampleSpec): Promise<CutSample> {
    const blob = await bookBlob(fmt);
    const key = sampleKey(fmt, spec);
    if ('pages' in spec) {
      return { blob: await cutPdfSample(await blob.arrayBuffer(), spec.pages.from, spec.pages.to), findings: [], key };
    }
    const n = spec.chapters;
    if (chapters.length <= n) {
      throw new Error(chapters.length
        ? `The product has ${chapters.length} chapter(s), so a sample of ${n} would be all of it. Choose fewer chapters.`
        : 'The product has no chapters yet. Find or add chapters first.');
    }
    const stop = chapters[n];
    // Links into the left-out chapters, and the closing note, lead to the book's store page. The
    // chapter titles tell the check which text is public (a contents list naming them).
    const links = {
      storeUrl: 'storePath' in spec && spec.storePath ? `${window.location.origin}${spec.storePath}` : '',
      nextChapterTitle: stop.title,
      chapterTitles: chapters.map(c => c.title),
    };
    if (fmt === 'html') {
      if (!stop.anchor) throw new Error(`Chapter ${n + 1} has no position in the file, so the sample cannot stop there. Upload a sample file instead.`);
      const cut = cutHtmlSample(await blob.text(), stop.anchor, links);
      return { blob: new Blob([cut.html], { type: 'text/html' }), html: cut.html, findings: cut.findings, key };
    }
    if (!stop.href) throw new Error(`Chapter ${n + 1} has no position in the file, so the sample cannot stop there. Upload a sample file instead.`);
    const cut = await cutEpubSample(blob, stop.href, links);
    return { blob: cut.blob, findings: cut.findings, key };
  }

  /** Save the cut sample the author reviewed and confirmed. */
  function createReviewedSample() {
    if (!sampleReview || !reviewAck) return;
    acceptedSample.current = sampleReview;
    setSampleReview(null);
    setReviewPreview(false);
    void save(status);
  }

  function downloadReviewSample() {
    if (!sampleReview) return;
    const url = URL.createObjectURL(sampleReview.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sample.${effectiveFormat ?? 'epub'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function moveChapter(i: number, dir: -1 | 1) {
    setChapters(prev => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save(nextStatus: BookStatus) {
    if (!editId || blocked) return;
    setError(''); setNotice('');
    if (!state.title.trim()) { setError('Add a title.'); return; }
    if (chaptersDirty && chapters.length === 0 && !window.confirm('Remove every chapter from this product?')) return;
    setSaving(nextStatus);
    try {
      const body: Record<string, unknown> = {
        id: editId,
        status: nextStatus,
        title: state.title,
        subtitle: state.subtitle,
        description: state.description,
        coverImage: state.coverImage,
        authors: splitList(state.authors),
        category: state.category,
        topics: splitList(state.topics),
        skills: splitList(state.skills),
        difficulty: state.difficulty || null,
        estimatedMinutes: state.estimatedMinutes,
        rightsHolder: state.rightsHolder,
        licenseType: state.licenseType || null,
        licenseUrl: state.licenseUrl,
        licenseExpiresAt: state.licenseExpiresAt || null,
        aiAllowed: state.aiAllowed,
        endorsementPermitted: state.endorsementPermitted,
        availableToEveryone: state.availableToEveryone,
        cohortIds: state.cohortIds,
        recommendedCourseIds: state.recommendedCourseIds,
        productType: state.productType,
        productTypeLabel: state.productTypeLabel,
        expectedUpdatedAt: loadedAt,
      };
      // A link product sends its address when it changed; saving one in place of a file removes the
      // file and its sample on the server.
      const linkProduct = delivery === 'link';
      if (linkProduct) {
        const link = normalizeProductLink(linkDraft);
        if (!link) { setError('Enter the full link, starting with https://'); setSaving(null); return; }
        if (link !== storedLink) {
          if ((storedFile.path || newFile) && !window.confirm('Use this link instead of the uploaded file? The file and its free sample will be removed.')) { setSaving(null); return; }
          body.link = { url: link };
        }
      } else {
        if (newFile && newFormat) body.file = { path: newFile.path, format: newFormat };
        if (preview === 'remove') body.preview = null;
        else if (preview) body.preview = { path: preview.path };
      }

      // The free sample is cut from the book here, before the save, when its settings, the book
      // file or (for a chapter-based cut) the chapter list changed. A failed cut does not stop the
      // rest of the save; the author is told and the next save tries again.
      const fmt = effectiveFormat;
      let sampleProblem = '';
      let sampleNeedsReview = false;
      let cutSpec: BookSampleSpec | null = null;
      if (linkProduct) {
        // No sample and no chapters for a link.
      } else if (sampleSource === 'upload') {
        body.sampleSpec = null;
      } else if (isReadableFormat(fmt) && (newFile || storedFile.path) && (sampleDirty || (fmt !== 'pdf' && chaptersDirty))) {
        const spec = currentSampleSpec(fmt);
        if (!spec) {
          sampleProblem = fmt === 'pdf' ? 'Enter the sample pages, for example 1 to 10.' : 'Enter how many chapters the sample has.';
        } else {
          setNotice('Making the free sample...');
          try {
            // The sample the author reviewed and confirmed, if it is still the same cut.
            const accepted = acceptedSample.current?.key === sampleKey(fmt, spec) ? acceptedSample.current : null;
            acceptedSample.current = null;
            const made = accepted ?? await makeSample(fmt, spec);
            if (!accepted && made.findings.length) {
              // Possible paid text in the sample: hold it for review instead of using it.
              setSampleReview(made);
              setReviewAck(false);
              sampleNeedsReview = true;
            } else {
              const uploaded = await putObject('preview', fmt, made.blob, `sample.${fmt}`);
              body.preview = { path: uploaded.path };
              body.sampleSpec = spec;
              cutSpec = spec;
              setSampleReview(null);
            }
          } catch (e: any) {
            // Includes SampleRefusedError: a sample that would plainly give away the paid chapters.
            sampleProblem = e?.message || 'The sample could not be made.';
            setSampleReview(null);
            setReviewAck(false);
          }
          setNotice('');
        }
      }

      // A chapter-based sample marks its chapters, so the store can show what the sample covers.
      const sampleCount = cutSpec && 'chapters' in cutSpec ? cutSpec.chapters : null;
      if (!linkProduct && isReadableFormat(effectiveFormat) && (chaptersDirty || sampleCount !== null)) {
        body.chapters = chapters.map((c, i) => ({
          id: c.id,
          title: c.title,
          estimatedMinutes: c.estimatedMinutes,
          required: c.required,
          isPreview: sampleCount !== null ? i < sampleCount : c.isPreview,
          locator: effectiveFormat === 'epub' ? { href: c.href }
            : effectiveFormat === 'html' ? { anchor: c.anchor }
            : { pageStart: c.pageStart, pageEnd: c.pageEnd },
        }));
        if (chapters.length === 0) body.clearChapters = true;
      }
      body.purchasable = state.purchasable;
      body.royaltyPct = Number(state.royaltyPct) || 0;
      if (pricesDirty) {
        body.prices = state.prices.filter(p => p.currency && p.amount).map(p => ({
          currency: p.currency,
          amount: Number(p.amount),
          saleAmount: p.saleAmount ? Number(p.saleAmount) : null,
          // The sale runs to the end of the chosen day, in the author's time zone.
          saleEndsAt: p.saleAmount && p.saleEndsAt ? new Date(`${p.saleEndsAt}T23:59:59`).toISOString() : null,
        }));
      }

      const res = await fetch('/api/books', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save the product.');

      const saved = d.book;
      setStatus(saved.status);
      setFormat(saved.format ?? null);
      setDelivery(saved.format === 'link' ? 'link' : 'file');
      if (saved.format === 'link') {
        if (body.link) setStoredLink((body.link as { url: string }).url);
        // Nothing is cut for a link; a file uploaded later sets the sample up again.
        setSampleSource('upload');
        setSampleDirty(false);
        setSampleReview(null);
      } else {
        setStoredLink(null);
        setLinkDraft('');
      }
      setStoredFile({ path: saved.file_path ?? null, size: saved.file_size ?? null });
      setStoredPreview(saved.preview_file_path ?? null);
      setNewFile(null); setNewFormat(null); setPreview(null);
      // Reload chapters so new rows carry their ids into the next save.
      setLoadedAt(saved.updated_at ?? null);
      setPricesDirty(false);
      const { data: chapterRows, error: reloadError } = await supabase.from('book_chapters').select('*').eq('book_id', editId).order('position');
      if (reloadError) {
        setBlocked(true);
        throw new Error('Saved, but the chapters could not be reloaded. Reload the page before editing again.');
      }
      setChaptersRaw((chapterRows ?? []).map(chapterFromRow));
      setChaptersDirty(false);
      // A failed cut stays owed: the save cleared chaptersDirty, so without this a cut triggered by
      // a chapter edit would never be retried and the old sample would stay.
      if (cutSpec) setSampleDirty(false);
      else if (sampleProblem || sampleNeedsReview) setSampleDirty(true);
      const done = nextStatus === 'published' ? 'Published' : nextStatus === 'archived' ? 'Archived' : 'Saved';
      if (sampleProblem) setError(`${done}, but the free sample was not made: ${sampleProblem}`);
      else if (sampleNeedsReview) {
        setNotice(`${done}. The new free sample is waiting for your review below, under Free sample.${storedPreview ? ' Until you confirm it, the previous sample stays in use.' : ''}`);
      }
      else setNotice(`${done}.${cutSpec ? ' The free sample was made from the product file.' : ''}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the product.');
    } finally {
      setSaving(null);
    }
  }

  async function saveAddress() {
    if (!editId) return;
    const next = normalizeProductAddress(addressDraft);
    if (!PRODUCT_ADDRESS.test(next)) { setAddressNote({ ok: false, text: 'Use 2 to 120 lowercase letters, numbers and hyphens.' }); return; }
    if (next === slug) { setAddressNote(null); return; }
    if (!window.confirm('Change the web address? Links already shared with the old address will stop working.')) return;
    setAddressBusy(true); setAddressNote(null);
    try {
      const res = await fetch('/api/books/address', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ id: editId, slug: next, expectedUpdatedAt: loadedAt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not change the address.');
      setSlug(d.slug); setAddressDraft(d.slug);
      // The address change moved the product's version on: this editor is now at that version.
      if (d.updatedAt) setLoadedAt(d.updatedAt);
      // A sample cut by chapters links to the product page: it is made again on the next save.
      const relinks = sampleSource === 'cut' && !!effectiveFormat && effectiveFormat !== 'pdf' && !!storedPreview;
      if (relinks) setSampleDirty(true);
      setAddressNote({ ok: true, text: relinks ? 'Address saved. Save the product to update the links in its free sample.' : 'Address saved.' });
    } catch (e: any) {
      setAddressNote({ ok: false, text: e?.message || 'Could not change the address.' });
    } finally {
      setAddressBusy(false);
    }
  }

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <div>
      <label className={labelCls} style={{ color: C.muted }}>{label}</label>
      {input}
      {hint && <p className="text-xs mt-1.5" style={{ color: C.muted }}>{hint}</p>}
    </div>
  );
  const inputStyle = { background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}><Loader2 className="w-7 h-7 animate-spin" style={{ color: C.muted }} /></div>;
  }

  const saveKind: BookStatus = status === 'published' ? 'published' : 'draft';
  const header = (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
      <button type="button" onClick={() => router.push('/dashboard#products')} className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 hover:opacity-80" style={{ color: C.muted }}>
        <ArrowLeft className="w-4 h-4" /> All products
      </button>
      {/* Buttons stay at the top right; a long name wraps instead of pushing them down. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 md:flex-1">
          <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
            {editId ? (state.title.trim() || 'Edit product') : 'New product'}
          </h1>
          {editId && (
            <div className="mt-2">
              {status === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : status === 'archived' ? <Pill tone="mute" C={C}>Archived</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
            </div>
          )}
        </div>
        {editId && (
          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:flex-shrink-0">
            {/* The product's page as buyers see it, drafts included (app/products/preview/[id]). */}
            <a href={`/products/preview/${encodeURIComponent(editId)}`} target="_blank" rel="noopener noreferrer"
              title="Opens in a new tab and shows the last saved version" className={btnClass} style={btnStyle('sec', C)}>
              <Eye className="w-4 h-4" /> Preview page
            </a>
            {status === 'published' && (
              <button type="button" onClick={() => save('archived')} disabled={!!saving || blocked} className={btnClass} style={btnStyle('sec', C)}>
                {saving === 'archived' && <Loader2 className="w-4 h-4 animate-spin" />} Archive
              </button>
            )}
            <button type="button" onClick={() => save(saveKind)} disabled={!!saving || !!uploading || blocked} className={btnClass} style={btnStyle(status === 'published' ? 'pri' : 'sec', C)}>
              {saving === saveKind ? <Loader2 className="w-4 h-4 animate-spin" /> : status !== 'published' && <Check className="w-4 h-4" />}
              {status === 'published' ? 'Save changes' : 'Save draft'}
            </button>
            {status !== 'published' && (
              <button type="button" onClick={() => save('published')} disabled={!!saving || !!uploading || blocked} className={btnClass} style={btnStyle('pri', C)}>
                {saving === 'published' && <Loader2 className="w-4 h-4 animate-spin" />} Publish
              </button>
            )}
          </div>
        )}
      </div>
      {editId && (
        <div role="tablist" aria-label="Product steps" className="inline-flex max-w-full gap-1 p-1 mt-5 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
          {BOOK_TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
                className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
                style={active ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const banner = (error || notice) && (
    <div role={error ? 'alert' : 'status'} className="mt-4 text-sm px-4 py-3 rounded-xl" style={error
      ? { background: P.badSoft, color: P.bad }
      : { background: C.card, color: P.good, boxShadow: `inset 0 0 0 1px ${P.goodSoft}` }}>
      {error || notice}
    </div>
  );

  if (!editId) {
    return (
      <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
        {header}
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {banner}
          <Card C={C} className="mt-4">
            <Sect C={C} title="Start a product" first>
              {field('Title', <input className={FIELD} style={inputStyle} value={newTitle} onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createDraft(); }} placeholder="SQL for Data Analysts" autoFocus />,
                'The product is created as a draft. You can upload the file and fill in the rest next.')}
              <div>
                <button type="button" onClick={createDraft} disabled={creating} className={btnClass} style={btnStyle('pri', C)}>
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create draft
                </button>
              </div>
            </Sect>
          </Card>
        </div>
      </div>
    );
  }

  const fileName = newFile?.name ?? (storedFile.path ? `Current ${format?.toUpperCase() ?? ''} file` : '');
  const previewName = preview === 'remove' ? '' : preview?.name ?? (storedPreview ? 'Current sample' : '');

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      {header}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {banner}
        <Card C={C} className="mt-4">

        {tab === 'details' && (<>
        <Sect C={C} title="About the product" first>
          {field('Title', <input className={FIELD} style={inputStyle} value={state.title} onChange={e => update({ title: e.target.value })} />)}
          {field('Subtitle', <input className={FIELD} style={inputStyle} value={state.subtitle} onChange={e => update({ subtitle: e.target.value })} />)}
          {editId && slug && field('Web address', (
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="field-shell flex flex-1 items-center rounded-[10px] overflow-hidden" style={inputStyle}>
                  <span className="pl-3 text-sm shrink-0" style={{ color: C.faint }}>/products/</span>
                  <input className="flex-1 min-w-0 bg-transparent px-1 py-3 text-sm outline-none" style={{ color: C.text }} value={addressDraft}
                    onChange={e => { setAddressDraft(e.target.value.toLowerCase().replace(/\s+/g, '-')); setAddressNote(null); }} aria-label="Web address" />
                </div>
                <button type="button" onClick={saveAddress} disabled={addressBusy || normalizeProductAddress(addressDraft) === slug}
                  className={`${btnClass} h-auto py-3`} style={btnStyle('sec', C)}>
                  {addressBusy ? 'Saving' : 'Save address'}
                </button>
              </div>
              {addressNote && <p className="text-xs" style={{ color: addressNote.ok ? P.good : P.bad }}>{addressNote.text}</p>}
            </div>
          ), 'Lowercase letters, numbers and hyphens. Changing it breaks links already shared.')}
          {field('Description', <RichTextEditor value={state.description} onChange={html => update({ description: html })} placeholder="What the product is, who it is for and what they get" enableAiAssist />,
            'Use bold, italics, lists and headings. This shows on the product page.')}
        </Sect>
        <Sect C={C} title="Catalogue">
          <div className="grid sm:grid-cols-2 gap-4">
            {field('Authors', <input className={FIELD} style={inputStyle} value={state.authors} onChange={e => update({ authors: e.target.value })} />, 'Separate names with commas.')}
            {field('Type', (
              <div className="space-y-2">
                <MenuSelect field label="Type" C={C} value={state.productType} onChange={v => update({ productType: v })}
                  options={PRODUCT_TYPES.map(t => ({ value: t as string, label: PRODUCT_TYPE_NAMES[t] }))} />
                {state.productType === 'other' && (
                  <input className={FIELD} style={inputStyle} value={state.productTypeLabel} maxLength={40}
                    onChange={e => update({ productTypeLabel: e.target.value })} placeholder="For example Dataset, Course pack, Checklist" aria-label="Type name" />
                )}
              </div>
            ), state.productType === 'other' && !state.productTypeLabel.trim() ? 'Name the type, or it is saved as Book.' : 'Shown on the product page and in the store.')}
            {field('Category', <input className={FIELD} style={inputStyle} value={state.category} onChange={e => update({ category: e.target.value })} placeholder="Data Engineering" />)}
            {field('Topics', <input className={FIELD} style={inputStyle} value={state.topics} onChange={e => update({ topics: e.target.value })} />, 'Separate with commas.')}
            {field('Skills', <input className={FIELD} style={inputStyle} value={state.skills} onChange={e => update({ skills: e.target.value })} />, 'Separate with commas.')}
            {field('Difficulty', (
              <MenuSelect field label="Difficulty" C={C} value={state.difficulty} onChange={v => update({ difficulty: v })}
                options={[{ value: '', label: 'Not set' }, ...BOOK_DIFFICULTIES.map(d => ({ value: d as string, label: d[0].toUpperCase() + d.slice(1) }))]} />
            ))}
            {field('Reading time (minutes)', <input className={FIELD} style={inputStyle} inputMode="numeric" value={state.estimatedMinutes} onChange={e => update({ estimatedMinutes: e.target.value.replace(/\D/g, '') })} />)}
          </div>
        </Sect>
        <Sect C={C} title="Cover">
          {state.coverImage ? (
            <div className="flex items-center gap-3">
              <img src={resolveCoverUrl(state.coverImage)} alt="" className="w-16 rounded-lg object-cover" style={{ height: 88 }} />
              <button type="button" onClick={() => setCoverOpen(true)} className={btnSmClass} style={btnStyle('sec', C)}>Change</button>
              <button type="button" onClick={() => update({ coverImage: '' })} className={btnSmClass} style={btnStyle('sec', C)}>Remove</button>
            </div>
          ) : (
            <button type="button" onClick={() => setCoverOpen(true)} className="w-full max-w-sm rounded-xl px-3 py-6 flex flex-col items-center gap-2" style={{ border: `2px dashed ${C.divider}` }}>
              <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />
              <span className="text-xs" style={{ color: C.muted }}>Select or upload a cover image</span>
            </button>
          )}
        </Sect>
        </>)}

        {/* Files, or a link (migration 243) */}
        {tab === 'file' && (<>
        <Sect C={C} title="Product file or link" first>
          <div className="inline-flex w-fit rounded-xl p-1 gap-1" style={{ background: C.page }} role="radiogroup" aria-label="How buyers get the product">
            {([['file', 'Upload a file'], ['link', 'Give a link']] as const).map(([value, label]) => (
              <button key={value} role="radio" aria-checked={delivery === value} onClick={() => setDelivery(value)}
                className="h-8 px-3 rounded-[9px] text-[13px] font-semibold"
                style={delivery === value ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                {label}
              </button>
            ))}
          </div>
          {delivery === 'link' ? (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: C.muted }}>For a Canva template, a Notion page, a shared folder or anything else online. Buyers only get the link after they buy or claim the product, through an Open button. It is never shown on the product page or in emails.</p>
              <input className={FIELD} style={inputStyle} type="url" inputMode="url" value={linkDraft} placeholder="https://"
                aria-label="Product link" onChange={e => setLinkDraft(e.target.value)} />
              <p className="text-xs" style={{ color: C.muted }}>Anyone who has the link can pass it on, so set it up in the tool itself to give a copy, for example a Canva template link or a Notion page people duplicate.</p>
              <div className="flex flex-wrap items-center gap-3">
                {storedLink && format === 'link' && (
                  <button onClick={() => previewSaved('full')} disabled={!!opening} className={btnSmClass} style={btnStyle('sec', C)}>
                    {opening === 'full' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />} Open link
                  </button>
                )}
                {(storedFile.path || newFile) && <span className="text-xs" style={{ color: C.muted }}>Saving with a link removes the uploaded file and its free sample.</span>}
              </div>
            </div>
          ) : (
          <>
          <p className="text-sm" style={{ color: C.muted }}>PDF, EPUB or interactive HTML, which buyers can read, or a ZIP, Excel, Word, PowerPoint, CSV, text or Markdown file they download. Up to 100 MB, or 10 MB for HTML. Files are private: buyers only ever get a short-lived link.</p>
          {format === 'link' && !newFile && <p className="text-xs" style={{ color: C.muted }}>Upload a file to use it instead of the link. Until then the product stays a link.</p>}
          <input ref={fileInput} type="file" accept={FILE_ACCEPT} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload('file', f); }} />
          <input ref={previewInput} type="file" accept={FILE_ACCEPT} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload('preview', f); }} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={!!uploading} className={btnClass} style={btnStyle('sec', C)}>
              {uploading === 'file' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {(storedFile.path && format !== 'link') || newFile ? 'Replace file' : 'Upload file'}
            </button>
            {fileName && <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
              <FileText className="w-3.5 h-3.5" /> {fileName} {sizeLabel(newFile?.size ?? storedFile.size)}{newFile ? ' (not saved yet)' : ''}
            </span>}
            {storedFile.path && !newFile && format && format !== 'link' && (
              <button onClick={() => previewSaved('full')} disabled={!!opening} className={btnSmClass} style={btnStyle('sec', C)}>
                {opening === 'full' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                {opensInBrowser(format) ? 'Preview product' : 'Download to check'}
              </button>
            )}
          </div>
          </>
          )}
        </Sect>
          {/* A product that is still a link (until a file is uploaded) has no sample. */}
          {delivery === 'file' && effectiveFormat !== 'link' && (
          <Sect C={C} title="Free sample">
            <p className="text-xs -mt-2" style={{ color: C.muted }}>People who have not bought the product get only this part, as a separate file, so the full product never reaches them.</p>
            {effectiveFormat && !isReadableFormat(effectiveFormat) ? (
              <p className="text-xs" style={{ color: C.muted }}>Optional. Upload a smaller {formatLabel(effectiveFormat)} to give away, for example a sample workbook with one sheet.</p>
            ) : (
            <div className="inline-flex w-fit rounded-xl p-1 gap-1" style={{ background: C.page }} role="radiogroup" aria-label="Sample source">
              {([['cut', 'Cut from the file'], ['upload', 'Upload a sample file']] as const).map(([value, label]) => (
                <button key={value} role="radio" aria-checked={sampleSource === value}
                  onClick={() => { if (sampleSource === value) return; setSampleSource(value); if (value === 'cut') sampleChanged(); else { setSampleDirty(false); setSampleReview(null); setReviewAck(false); } }}
                  className="h-8 px-3 rounded-[9px] text-[13px] font-semibold"
                  style={sampleSource === value ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                  {label}
                </button>
              ))}
            </div>
            )}
            {sampleSource === 'cut' ? (
              <div className="space-y-2">
                {effectiveFormat === 'pdf' ? (
                  <label className="flex flex-wrap items-center gap-2 text-xs" style={{ color: C.muted }}>Pages
                    <input className="w-16 rounded-lg px-2 py-1 outline-none" style={inputStyle} inputMode="numeric" aria-label="First sample page" value={samplePages.from}
                      onChange={e => { setSamplePages(p => ({ ...p, from: e.target.value.replace(/\D/g, '') })); sampleChanged(); }} />
                    to
                    <input className="w-16 rounded-lg px-2 py-1 outline-none" style={inputStyle} inputMode="numeric" aria-label="Last sample page" value={samplePages.to}
                      onChange={e => { setSamplePages(p => ({ ...p, to: e.target.value.replace(/\D/g, '') })); sampleChanged(); }} />
                    {pageCount ? <span style={{ color: C.faint }}>of {pageCount}</span> : null}
                  </label>
                ) : (
                  <label className="flex flex-wrap items-center gap-2 text-xs" style={{ color: C.muted }}>The first
                    <input className="w-16 rounded-lg px-2 py-1 outline-none" style={inputStyle} inputMode="numeric" aria-label="Chapters in the sample" value={sampleChapters}
                      onChange={e => { setSampleChapters(e.target.value.replace(/\D/g, '')); sampleChanged(); }} />
                    chapters{chapters.length ? <span style={{ color: C.faint }}>of {chapters.length}</span> : null}
                  </label>
                )}
                <p className="text-xs" style={{ color: C.muted }}>
                  {!effectiveFormat ? 'Upload the product file first.'
                    : sampleDirty ? 'The sample is made from the file when you save.'
                    : storedPreview ? 'The current sample matches these settings.' : 'The sample is made from the file when you save.'}
                </p>
                {sampleReview && (
                  <div className="rounded-xl p-4 space-y-3" style={{ background: C.page }}>
                    <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
                      <AlertTriangle className="w-4 h-4" style={{ color: P.warn }} /> Check this sample before it is used
                    </p>
                    <p className="text-xs" style={{ color: C.muted }}>
                      We looked for text from the paid chapters in parts of the sample a reader does not normally see. What we found is listed below. It may be fine, for example text your book repeats on purpose, but please check it. This is a check for possible exposure of paid content; it cannot guarantee that a sample contains none.
                    </p>
                    <ul className="space-y-1.5">
                      {sampleReview.findings.map((f, i) => (
                        <li key={i} className="text-xs" style={{ color: C.muted }}>
                          <span className="font-semibold" style={{ color: C.text }}>{f.where}:</span> {'"'}{f.excerpt}{'"'}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-3">
                      {sampleReview.html ? (
                        <button onClick={() => setReviewPreview(true)} className={btnSmClass} style={btnStyle('sec', C)}>
                          <Eye className="w-3.5 h-3.5" /> Preview the sample
                        </button>
                      ) : (
                        <button onClick={downloadReviewSample} className={btnSmClass} style={btnStyle('sec', C)}>
                          <Download className="w-3.5 h-3.5" /> Download the sample to check
                        </button>
                      )}
                    </div>
                    <label className="flex items-start gap-2 text-xs" style={{ color: C.text }}>
                      <input type="checkbox" checked={reviewAck} onChange={e => setReviewAck(e.target.checked)} className="mt-0.5" />
                      I have reviewed this sample, and it only contains what I want to give away for free.
                    </label>
                    <button onClick={createReviewedSample} disabled={!reviewAck || !!saving}
                      className={btnSmClass} style={btnStyle('pri', C)}>
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Create sample anyway
                    </button>
                  </div>
                )}
                {reviewPreview && sampleReview?.html && (
                  // The sample shown in a sandboxed frame without same-origin: the book's own scripts
                  // cannot reach this page or its session.
                  <div className="fixed inset-0 z-50 flex flex-col p-3 sm:p-6" style={{ background: 'rgba(15,23,42,0.6)' }} role="dialog" aria-label="Sample preview">
                    <div className="flex items-center justify-between rounded-t-2xl px-4 py-3" style={{ background: C.card }}>
                      <p className="text-sm font-semibold" style={{ color: C.text }}>Sample preview</p>
                      <button onClick={() => setReviewPreview(false)} aria-label="Close preview" className="p-1.5 rounded-lg" style={{ color: C.muted }}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <iframe title="Sample preview" sandbox="allow-scripts" srcDoc={sampleReview.html} className="flex-1 w-full rounded-b-2xl bg-white" />
                  </div>
                )}
                {/* A sample made before the cutter changed (or one to redo for any reason) is not
                    remade by a plain save, since nothing it depends on changed. This marks it. */}
                {storedPreview && !sampleDirty && (newFile || storedFile.path) && (
                  <button onClick={() => { sampleChanged(); setNotice('The sample will be made again from the file when you save.'); }}
                    className={`${btnSmClass} w-fit`} style={btnStyle('sec', C)}>
                    <RefreshCw className="w-3.5 h-3.5" /> Remake sample
                  </button>
                )}
                {storedPreview && !sampleDirty && !preview && format && (
                  <button onClick={() => previewSaved('sample')} disabled={!!opening} className={`${btnSmClass} w-fit`} style={btnStyle('sec', C)}>
                    {opening === 'sample' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    {opensInBrowser(format) ? 'Preview sample' : 'Download sample'}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => previewInput.current?.click()} disabled={!!uploading || !effectiveFormat} className={btnSmClass} style={btnStyle('sec', C)}>
                  {uploading === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {previewName ? 'Replace sample' : 'Upload sample'}
                </button>
                {previewName && <>
                  <span className="text-xs" style={{ color: C.muted }}>{previewName}{preview && preview !== 'remove' ? ' (not saved yet)' : ''}</span>
                  {storedPreview && !preview && format && (
                    <button onClick={() => previewSaved('sample')} disabled={!!opening} className={`${btnSmClass} w-fit`} style={btnStyle('sec', C)}>
                      {opening === 'sample' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      {opensInBrowser(format) ? 'Preview sample' : 'Download sample'}
                    </button>
                  )}
                  <button type="button" onClick={() => setPreview('remove')} className={btnSmClass} style={btnStyle('sec', C)}>Remove</button>
                </>}
              </div>
            )}
          </Sect>
          )}

        {/* Chapters: buyers never see them; they only tell a chapter-cut sample (EPUB, HTML) where to
            stop. So the section appears only then. PDF samples are cut by page range and uploaded
            samples are not cut, so neither needs chapters. */}
        {delivery === 'file' && isReadableFormat(effectiveFormat) && effectiveFormat !== 'pdf' && sampleSource === 'cut' && (
        <Sect C={C} title="Chapters" aside={chapters.length ? `${chapters.length} chapter${chapters.length === 1 ? '' : 's'}` : undefined}>
          <p className="text-xs -mt-2" style={{ color: C.muted }}>
            {findingChapters ? 'Reading the chapters from the file...'
              : 'Used to cut the free sample. Chapters are read from the file\'s table of contents or headings when you upload it. If it has none, AI suggests them. Rename or remove any you do not want, then save.'}
          </p>
          {chapters.length === 0 && <p className="rounded-xl px-4 py-5 text-center text-[13px]" style={{ border: `2px dashed ${C.divider}`, color: C.muted }}>No chapters yet</p>}
          {chapters.length > 0 && (
          <div className="space-y-2">
            {chapters.map((ch, i) => (
              <div key={ch.key} className="rounded-xl px-3 py-2.5 space-y-2" style={{ background: C.page }}>
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{i + 1}</span>
                  <input className={FIELD} style={{ ...inputStyle, background: C.card }} value={ch.title} placeholder="Chapter title" aria-label={`Chapter ${i + 1} title`}
                    onChange={e => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, title: e.target.value } : c))} />
                  <button type="button" onClick={() => moveChapter(i, -1)} disabled={i === 0} aria-label="Move up" className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0 disabled:opacity-30" style={{ background: C.card, color: C.muted }}><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" onClick={() => moveChapter(i, 1)} disabled={i === chapters.length - 1} aria-label="Move down" className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0 disabled:opacity-30" style={{ background: C.card, color: C.muted }}><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setChapters(prev => prev.filter(c => c.key !== ch.key))} aria-label="Remove chapter" className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap items-center gap-4 pl-9 text-xs" style={{ color: C.muted }}>
                  {effectiveFormat === 'epub' && ch.href && <span className="truncate max-w-[16rem]">{ch.href}</span>}
                  {effectiveFormat === 'html' && ch.anchor && <span>#{ch.anchor}</span>}
                  <span className="flex items-center gap-2">Counts toward completion
                    <Switch on={ch.required} label="Counts toward completion" C={C} onChange={() => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, required: !c.required } : c))} />
                  </span>
                </div>
              </div>
            ))}
          </div>
          )}
          <div className="flex flex-wrap gap-2">
            {effectiveFormat && (newFile || storedFile.path) && (
              <button type="button" onClick={() => findChapters()} disabled={findingChapters || !!uploading} className={btnSmClass} style={btnStyle('sec', C)}>
                {findingChapters ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListOrdered className="w-3.5 h-3.5" />} Find chapters
              </button>
            )}
            <button type="button" onClick={() => setChapters(prev => [...prev, { key: newKey(), title: '', href: '', anchor: '', pageStart: '', pageEnd: '', estimatedMinutes: null, required: true, isPreview: false }])}
              className={btnSmClass} style={btnStyle('sec', C)}>
              <Plus className="w-3.5 h-3.5" /> Add chapter
            </button>
          </div>
        </Sect>
        )}
        </>)}

        {tab === 'rights' && (<>
        <Sect C={C} title="Licence" first>
          <div className="grid sm:grid-cols-2 gap-4">
            {field('Licence', (
              <MenuSelect field label="Licence" C={C} value={state.licenseType} onChange={v => update({ licenseType: v })} placeholder="Choose a licence"
                options={BOOK_LICENSE_TYPES.map(l => ({ value: l as string, label: LICENSE_LABELS[l] }))} />
            ), 'Required to publish.')}
            {field('Rights holder', <input className={FIELD} style={inputStyle} value={state.rightsHolder} onChange={e => update({ rightsHolder: e.target.value })} />)}
            {field('Licence link', <input className={FIELD} style={inputStyle} value={state.licenseUrl} onChange={e => update({ licenseUrl: e.target.value })} placeholder="https://" />)}
            {field('Licence ends', <DateField label="Licence ends" placeholder="No end date" value={state.licenseExpiresAt} onChange={licenseExpiresAt => update({ licenseExpiresAt })} C={C} />, 'Readers lose access on this date. Leave empty if it never ends.')}
          </div>
        </Sect>
        <Sect C={C} title="Permissions">
          <SwitchRow C={C} title="AI may read this product" sub="To explain it and write practice questions." on={state.aiAllowed} onChange={v => update({ aiAllowed: v })} />
          <div className="pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
            <SwitchRow C={C} title="Named on certificates" sub="The author or publisher has agreed to be named on certificates." on={state.endorsementPermitted} onChange={v => update({ endorsementPermitted: v })} />
          </div>
        </Sect>
        </>)}

        {tab === 'access' && (<>
        <Sect C={C} title="Who can read it" first aside={state.availableToEveryone ? 'Everyone' : `${state.cohortIds.length} cohort${state.cohortIds.length === 1 ? '' : 's'}`}>
          <SwitchRow C={C} title="Free for everyone" sub="Signed-in learners download it straight away; visitors without an account enter their name and email and get the link by email."
            on={state.availableToEveryone} onChange={v => update({ cohortIds: [], availableToEveryone: v })} />
          {cohorts.length > 0 && (
            <div style={state.availableToEveryone ? { opacity: 0.45 } : undefined}>
              {cohorts.map((c, i) => {
                const on = state.cohortIds.includes(c.id);
                return (
                  <button key={c.id} type="button" role="checkbox" aria-checked={on}
                    onClick={() => update({ availableToEveryone: false, cohortIds: on ? state.cohortIds.filter(x => x !== c.id) : [...state.cohortIds, c.id] })}
                    className="w-full flex items-center gap-3 px-1 py-3 text-left text-sm font-semibold" style={{ color: C.text, borderTop: i ? `1px solid ${C.divider}` : undefined }}>
                    <Tick on={on} C={C} />{c.name}
                  </button>
                );
              })}
            </div>
          )}
          {!state.availableToEveryone && (
            <p className="text-xs" style={{ color: C.muted }}>
              {state.cohortIds.length ? 'Free for the selected cohorts.' : state.purchasable ? 'Only people who buy it.' : 'Nobody can read it yet. Choose a cohort, everyone, or sell it.'}
            </p>
          )}
        </Sect>

        <Sect C={C} title="Recommend with courses" aside={`${state.recommendedCourseIds.length} course${state.recommendedCourseIds.length === 1 ? '' : 's'}`}>
          <p className="text-xs -mt-2" style={{ color: C.muted }}>
            This product shows on these course pages, and in What to take next when a learner passes them.
          </p>
          {courses.length === 0 ? (
            <p className="text-xs" style={{ color: C.muted }}>You have no courses to pick yet.</p>
          ) : (
            <>
              {courses.length > 8 && (
                <input className={FIELD} style={inputStyle} value={courseQuery} onChange={e => setCourseQuery(e.target.value)}
                  placeholder="Search your courses" aria-label="Search courses" />
              )}
              <div>
                {courses
                  .filter(c => state.recommendedCourseIds.includes(c.id) || !courseQuery.trim() || c.title.toLowerCase().includes(courseQuery.trim().toLowerCase()))
                  .slice(0, 60)
                  .map((c, i) => {
                    const on = state.recommendedCourseIds.includes(c.id);
                    return (
                      <button key={c.id} type="button" role="checkbox" aria-checked={on}
                        onClick={() => update({ recommendedCourseIds: on ? state.recommendedCourseIds.filter(x => x !== c.id) : [...state.recommendedCourseIds, c.id].slice(0, 20) })}
                        className="w-full flex items-center gap-3 px-1 py-3 text-left text-sm font-semibold" style={{ color: C.text, borderTop: i ? `1px solid ${C.divider}` : undefined }}>
                        <Tick on={on} C={C} />{c.title}{c.status === 'draft' ? ' (draft)' : ''}
                      </button>
                    );
                  })}
              </div>
              {state.recommendedCourseIds.length >= 20 && <p className="text-xs" style={{ color: C.muted }}>Up to 20 courses.</p>}
            </>
          )}
        </Sect>
        </>)}

        {tab === 'selling' && (
        <Sect C={C} title="Selling" first>
            <SwitchRow C={C} title="Sell this product on its own" on={state.purchasable} onChange={v => update({ purchasable: v })} />
            {state.purchasable && <>
              <div className="space-y-2">
                <label className={labelCls} style={{ color: C.muted }}>Prices</label>
                {state.prices.map((p, i) => {
                  const set = (patch: Partial<EditorState['prices'][number]>) => updatePrices(state.prices.map((q, j) => j === i ? { ...q, ...patch } : q));
                  const saleTooHigh = !!p.saleAmount && !!p.amount && !(Number(p.saleAmount) < Number(p.amount));
                  const onSoft = { ...inputStyle, background: C.card };
                  return (
                    <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: C.page }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="field-focus w-24 rounded-[10px] px-3 py-2.5 text-sm outline-none uppercase" style={onSoft} maxLength={3} placeholder="GHS" aria-label="Currency" value={p.currency}
                          onChange={e => set({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                        <input className="field-focus w-32 rounded-[10px] px-3 py-2.5 text-sm outline-none" style={onSoft} inputMode="decimal" placeholder="0.00" aria-label="Price" value={p.amount}
                          onChange={e => set({ amount: e.target.value.replace(/[^0-9.]/g, '') })} />
                        <button type="button" onClick={() => updatePrices(state.prices.filter((_, j) => j !== i))} aria-label="Remove price" className="ml-auto w-8 h-8 rounded-[10px] grid place-items-center" style={{ background: P.badSoft, color: P.bad }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: C.muted }}>
                        <label className="flex items-center gap-2">Sale price
                          <input className="field-focus w-28 rounded-[10px] px-3 py-2 text-sm outline-none" style={onSoft} inputMode="decimal" placeholder="Optional" value={p.saleAmount}
                            onChange={e => set({ saleAmount: e.target.value.replace(/[^0-9.]/g, '') })} />
                        </label>
                        {p.saleAmount && (
                          <label className="flex items-center gap-2">until
                            <DateField className="w-48" compact label="Sale ends" placeholder="No end date" value={p.saleEndsAt} onChange={saleEndsAt => set({ saleEndsAt })} C={C} />
                          </label>
                        )}
                        {p.saleAmount && !p.saleEndsAt && <span>No end date: the sale runs until you remove it.</span>}
                      </div>
                      {saleTooHigh && <p className="text-xs" style={{ color: P.bad }}>The sale price must be lower than the regular price, or it is ignored.</p>}
                    </div>
                  );
                })}
                <div>
                  <button type="button" onClick={() => updatePrices([...state.prices, { currency: '', amount: '', saleAmount: '', saleEndsAt: '' }])} className={btnSmClass} style={btnStyle('sec', C)}>
                    <Plus className="w-3.5 h-3.5" /> Add a price
                  </button>
                </div>
              </div>
              {field('Author royalty (%)', <input className={`${FIELD} max-w-[8rem]`} style={inputStyle} inputMode="decimal" value={state.royaltyPct}
                onChange={e => update({ royaltyPct: e.target.value.replace(/[^0-9.]/g, '') })} />, 'Recorded on each sale, so changing it later never rewrites past sales.')}
            </>}
        </Sect>
        )}
        </Card>
      </div>

      {coverOpen && (
        <ImageLibrary uploadFolder="book-covers" initialFolder="book-covers"
          onSelect={v => update({ coverImage: v })} onClose={() => setCoverOpen(false)} />
      )}
    </div>
  );
}
