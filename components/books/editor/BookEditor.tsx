'use client';

// The book editor at /create/product (new) and /create/product?id= (edit). Uses the create editor's
// local theme, as the other /create pages do. Every save goes through /api/books, which re-checks
// ownership, uploaded files and publish readiness; this page only helps
// the author get there.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Download, Eye, FileText, ImagePlus, Library, ListOrdered, Loader2, Plus, RefreshCw,
  Trash2, Upload, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useC } from '@/components/create/theme';
import { useC as useLibC } from '@/lib/theme';
import { Toggle, inputCls, labelCls } from '@/components/create/shared';
import { ImageLibrary } from '@/components/ImageLibrary';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import {
  BOOK_DIFFICULTIES,
  BOOK_FILE_MAX_BYTES,
  BOOK_HTML_MAX_BYTES,
  BOOK_LICENSE_TYPES,
  DEFAULT_SAMPLE_CHAPTERS,
  DEFAULT_SAMPLE_PAGES,
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

const LICENSE_LABELS: Record<BookLicenseType, string> = {
  own: 'Our own work',
  cc_by: 'Creative Commons BY',
  cc_by_sa: 'Creative Commons BY-SA',
  cc_by_nc: 'Creative Commons BY-NC',
  public_domain: 'Public domain',
  licensed: 'Licensed from a publisher',
  other: 'Other',
};

const FORMAT_BY_EXTENSION: Record<string, BookFormat> = { epub: 'epub', pdf: 'pdf', html: 'html', htm: 'html' };

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
  purchasable: boolean;
  royaltyPct: string;
  // saleAmount and saleEndsAt (a date, yyyy-mm-dd) are optional: a sale price shown with the
  // regular price crossed out, until the end of that day.
  prices: { currency: string; amount: string; saleAmount: string; saleEndsAt: string }[];
};

const EMPTY: EditorState = {
  title: '', subtitle: '', description: '', coverImage: '', authors: '', category: '', topics: '', skills: '',
  difficulty: '', estimatedMinutes: '', rightsHolder: '', licenseType: '', licenseUrl: '', licenseExpiresAt: '',
  aiAllowed: true, endorsementPermitted: false, availableToEveryone: false, cohortIds: [],
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

export function BookEditor() {
  const baseC = useC();
  const libC = useLibC();
  const C = useMemo(() => ({ ...baseC, cta: libC.cta, ctaText: '#ffffff', cardBorder: 'transparent' }), [baseC, libC]);
  const router = useRouter();
  const editId = useSearchParams().get('id');

  const [state, setState] = useState<EditorState>(EMPTY);
  const [status, setStatus] = useState<BookStatus>('draft');
  const [format, setFormat] = useState<BookFormat | null>(null);
  // For the sample's links back to the book's store page.
  const [slug, setSlug] = useState('');
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
        title: book.title ?? '', subtitle: book.subtitle ?? '', description: book.description ?? '',
        coverImage: book.cover_image ?? '', authors: (book.authors ?? []).join(', '), category: book.category ?? '',
        topics: (book.topics ?? []).join(', '), skills: (book.skills ?? []).join(', '),
        difficulty: book.difficulty ?? '', estimatedMinutes: book.estimated_minutes ? String(book.estimated_minutes) : '',
        rightsHolder: book.rights_holder ?? '', licenseType: book.license_type ?? '', licenseUrl: book.license_url ?? '',
        licenseExpiresAt: book.license_expires_at ? String(book.license_expires_at).slice(0, 10) : '',
        aiAllowed: book.ai_allowed !== false, endorsementPermitted: book.endorsement_permitted === true,
        availableToEveryone: book.available_to_everyone === true, cohortIds: book.cohort_ids ?? [],
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
      setSlug(book.slug ?? '');
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
      setSampleSource(spec || !book.preview_file_path ? 'cut' : 'upload');
      // A chapter cut whose links lead to an older store address (or none recorded) is made again
      // on the next save, so its links reach the product page.
      const staleLinks = !!spec && 'chapters' in spec && !!book.file_path && !!book.slug && spec.storePath !== sampleStorePath(book.slug);
      setSampleDirty((!spec && !book.preview_file_path && !!book.file_path) || staleLinks);
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
    if (!fmt) { setError('Choose an EPUB, PDF or HTML file.'); return; }
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
        bookData.current = { blob: file, format: fmt };
        setPageCount(null);
        if (fmt !== format && (storedPreview || preview)) setPreview('remove');
        if (sampleSource === 'cut') sampleChanged();
        else setSampleReview(null);
        setNotice('Uploaded. Save to keep it.');
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
        expectedUpdatedAt: loadedAt,
      };
      if (newFile && newFormat) body.file = { path: newFile.path, format: newFormat };
      if (preview === 'remove') body.preview = null;
      else if (preview) body.preview = { path: preview.path };

      // The free sample is cut from the book here, before the save, when its settings, the book
      // file or (for a chapter-based cut) the chapter list changed. A failed cut does not stop the
      // rest of the save; the author is told and the next save tries again.
      const fmt = effectiveFormat;
      let sampleProblem = '';
      let sampleNeedsReview = false;
      let cutSpec: BookSampleSpec | null = null;
      if (sampleSource === 'upload') {
        body.sampleSpec = null;
      } else if (fmt && (newFile || storedFile.path) && (sampleDirty || (fmt !== 'pdf' && chaptersDirty))) {
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
      if (chaptersDirty || sampleCount !== null) {
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

  const card = { background: C.card } as const;
  const sectionTitle = (t: string) => <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: C.cta }}>{t}</p>;
  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <div>
      <label className={labelCls} style={{ color: C.faint }}>{label}</label>
      {input}
      {hint && <p className="text-xs mt-1.5" style={{ color: C.faint }}>{hint}</p>}
    </div>
  );
  const inputStyle = { background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}><Loader2 className="w-7 h-7 animate-spin" style={{ color: C.cta }} /></div>;
  }

  const header = (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
      <div className="rounded-2xl px-5 sm:px-7 py-6 flex items-start justify-between gap-4" style={{ ...card, boxShadow: C.cardShadow }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.cta }}>
            <Library className="w-4 h-4" /> Product Studio
          </div>
          <h1 className="mt-2 truncate text-xl sm:text-2xl font-bold" style={{ color: C.text }}>
            {editId ? (state.title.trim() || 'Edit product') : 'New product'}
          </h1>
          {editId && <p className="text-xs mt-1 capitalize" style={{ color: C.faint }}>{status}{effectiveFormat ? ` / ${effectiveFormat.toUpperCase()}` : ''}</p>}
        </div>
        <button onClick={() => router.push('/dashboard#products')} className="shrink-0 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
          style={{ background: C.pill, color: C.muted }}>
          <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Digital Products</span>
        </button>
      </div>
    </div>
  );

  const banner = (error || notice) && (
    <div className="text-sm px-4 py-3 rounded-xl" style={error
      ? { background: 'rgba(244,63,94,0.1)', color: '#f43f5e' }
      : { background: '#ffffff', color: '#16a34a', boxShadow: 'inset 0 0 0 1px #bbf7d0' }}>
      {error || notice}
    </div>
  );

  if (!editId) {
    return (
      <div className="min-h-screen pb-28" style={{ background: C.page, color: C.text }}>
        {header}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {banner}
          <div className="rounded-2xl p-5 sm:p-7 space-y-4" style={card}>
            {sectionTitle('Start a product')}
            {field('Title', <input className={inputCls} style={inputStyle} value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createDraft(); }} placeholder="SQL for Data Analysts" autoFocus />,
              'The product is created as a draft. You can upload the file and fill in the rest next.')}
            <button onClick={createDraft} disabled={creating} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: C.cta, color: C.ctaText }}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create draft
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fileName = newFile?.name ?? (storedFile.path ? `Current ${format?.toUpperCase() ?? ''} file` : '');
  const previewName = preview === 'remove' ? '' : preview?.name ?? (storedPreview ? 'Current sample' : '');

  return (
    <div className="min-h-screen pb-32" style={{ background: C.page, color: C.text }}>
      {header}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {banner}

        {/* Details */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={card}>
          {sectionTitle('Details')}
          {field('Title', <input className={inputCls} style={inputStyle} value={state.title} onChange={e => update({ title: e.target.value })} />)}
          {field('Subtitle', <input className={inputCls} style={inputStyle} value={state.subtitle} onChange={e => update({ subtitle: e.target.value })} />)}
          {field('Description', <textarea className={inputCls} style={inputStyle} rows={5} value={state.description} onChange={e => update({ description: e.target.value })} />)}
          <div className="grid sm:grid-cols-2 gap-5">
            {field('Authors', <input className={inputCls} style={inputStyle} value={state.authors} onChange={e => update({ authors: e.target.value })} />, 'Separate names with commas.')}
            {field('Category', <input className={inputCls} style={inputStyle} value={state.category} onChange={e => update({ category: e.target.value })} placeholder="Data Engineering" />)}
            {field('Topics', <input className={inputCls} style={inputStyle} value={state.topics} onChange={e => update({ topics: e.target.value })} />, 'Separate with commas.')}
            {field('Skills', <input className={inputCls} style={inputStyle} value={state.skills} onChange={e => update({ skills: e.target.value })} />, 'Separate with commas.')}
            {field('Difficulty', (
              <select className={inputCls} style={inputStyle} value={state.difficulty} onChange={e => update({ difficulty: e.target.value })}>
                <option value="">Not set</option>
                {BOOK_DIFFICULTIES.map(d => <option key={d} value={d} className="capitalize">{d[0].toUpperCase() + d.slice(1)}</option>)}
              </select>
            ))}
            {field('Reading time (minutes)', <input className={inputCls} style={inputStyle} inputMode="numeric" value={state.estimatedMinutes} onChange={e => update({ estimatedMinutes: e.target.value.replace(/\D/g, '') })} />)}
          </div>
          {field('Cover', state.coverImage ? (
            <div className="flex items-center gap-3">
              <img src={resolveCoverUrl(state.coverImage)} alt="" className="w-16 rounded-lg object-cover" style={{ height: 88 }} />
              <button onClick={() => setCoverOpen(true)} className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: C.pill, color: C.muted }}>Change</button>
              <button onClick={() => update({ coverImage: '' })} className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: C.pill, color: '#dc2626' }}>Remove</button>
            </div>
          ) : (
            <button onClick={() => setCoverOpen(true)} className="w-full rounded-xl px-3 py-6 flex flex-col items-center gap-2" style={{ background: C.input, border: `1.5px dashed ${C.inputBorder}` }}>
              <ImagePlus className="w-5 h-5" style={{ color: C.faint }} />
              <span className="text-xs" style={{ color: C.faint }}>Select or upload a cover image</span>
            </button>
          ))}
        </div>

        {/* Files */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={card}>
          {sectionTitle('Product file')}
          <p className="text-sm" style={{ color: C.faint }}>EPUB or PDF up to 100 MB, or a self-contained HTML file up to 10 MB. Files are private: readers only ever get a short-lived link.</p>
          <input ref={fileInput} type="file" accept=".epub,.pdf,.html,.htm" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload('file', f); }} />
          <input ref={previewInput} type="file" accept=".epub,.pdf,.html,.htm" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload('preview', f); }} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => fileInput.current?.click()} disabled={!!uploading} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: C.cta, color: C.ctaText }}>
              {uploading === 'file' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {storedFile.path || newFile ? 'Replace file' : 'Upload file'}
            </button>
            {fileName && <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
              <FileText className="w-3.5 h-3.5" /> {fileName} {sizeLabel(newFile?.size ?? storedFile.size)}{newFile ? ' (not saved yet)' : ''}
            </span>}
            {storedFile.path && !newFile && format && (
              <button onClick={() => previewSaved('full')} disabled={!!opening} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{ background: C.pill, color: C.muted }}>
                {opening === 'full' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                {format === 'epub' ? 'Download to check' : 'Preview product'}
              </button>
            )}
          </div>
          <div className="pt-4 space-y-3" style={{ borderTop: `1px solid ${C.divider}` }}>
            <p className="text-sm font-medium" style={{ color: C.text }}>Free sample</p>
            <p className="text-xs" style={{ color: C.faint }}>People who have not bought the product get only this part, as a separate file, so the full product never reaches them.</p>
            <div className="inline-flex rounded-xl p-1 gap-1" style={{ background: C.input }} role="radiogroup" aria-label="Sample source">
              {([['cut', 'Cut from the file'], ['upload', 'Upload a sample file']] as const).map(([value, label]) => (
                <button key={value} role="radio" aria-checked={sampleSource === value}
                  onClick={() => { if (sampleSource === value) return; setSampleSource(value); if (value === 'cut') sampleChanged(); else { setSampleDirty(false); setSampleReview(null); setReviewAck(false); } }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={sampleSource === value ? { background: C.cta, color: C.ctaText } : { color: C.muted }}>
                  {label}
                </button>
              ))}
            </div>
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
                <p className="text-xs" style={{ color: C.faint }}>
                  {!effectiveFormat ? 'Upload the product file first.'
                    : sampleDirty ? 'The sample is made from the file when you save.'
                    : storedPreview ? 'The current sample matches these settings.' : 'The sample is made from the file when you save.'}
                </p>
                {sampleReview && (
                  <div className="rounded-xl p-4 space-y-3" style={{ background: C.input }}>
                    <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
                      <AlertTriangle className="w-4 h-4" style={{ color: '#d97706' }} /> Check this sample before it is used
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
                        <button onClick={() => setReviewPreview(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                          style={{ background: C.pill, color: C.muted }}>
                          <Eye className="w-3.5 h-3.5" /> Preview the sample
                        </button>
                      ) : (
                        <button onClick={downloadReviewSample} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                          style={{ background: C.pill, color: C.muted }}>
                          <Download className="w-3.5 h-3.5" /> Download the sample to check
                        </button>
                      )}
                    </div>
                    <label className="flex items-start gap-2 text-xs" style={{ color: C.text }}>
                      <input type="checkbox" checked={reviewAck} onChange={e => setReviewAck(e.target.checked)} className="mt-0.5" />
                      I have reviewed this sample, and it only contains what I want to give away for free.
                    </label>
                    <button onClick={createReviewedSample} disabled={!reviewAck || !!saving}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                      style={{ background: C.cta, color: C.ctaText }}>
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
                    className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.muted }}>
                    <RefreshCw className="w-3.5 h-3.5" /> Remake sample
                  </button>
                )}
                {storedPreview && !sampleDirty && !preview && format && (
                  <button onClick={() => previewSaved('sample')} disabled={!!opening} className="inline-flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50" style={{ color: C.muted }}>
                    {opening === 'sample' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    {format === 'epub' ? 'Download sample' : 'Preview sample'}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => previewInput.current?.click()} disabled={!!uploading || !effectiveFormat} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                  style={{ background: C.pill, color: C.muted }}>
                  {uploading === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {previewName ? 'Replace sample' : 'Upload sample'}
                </button>
                {previewName && <>
                  <span className="text-xs" style={{ color: C.muted }}>{previewName}{preview && preview !== 'remove' ? ' (not saved yet)' : ''}</span>
                  {storedPreview && !preview && format && (
                    <button onClick={() => previewSaved('sample')} disabled={!!opening} className="inline-flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50" style={{ color: C.muted }}>
                      {opening === 'sample' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      {format === 'epub' ? 'Download sample' : 'Preview sample'}
                    </button>
                  )}
                  <button onClick={() => setPreview('remove')} className="text-xs" style={{ color: '#dc2626' }}>Remove</button>
                </>}
              </div>
            )}
          </div>
        </div>

        {/* Chapters */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-4" style={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {sectionTitle('Chapters')}
            <div className="flex gap-2">
              {effectiveFormat && (newFile || storedFile.path) && (
                <button onClick={() => findChapters()} disabled={findingChapters || !!uploading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                  style={{ background: C.pill, color: C.muted }}>
                  {findingChapters ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListOrdered className="w-3.5 h-3.5" />} Find chapters
                </button>
              )}
              <button onClick={() => setChapters(prev => [...prev, { key: newKey(), title: '', href: '', anchor: '', pageStart: '', pageEnd: '', estimatedMinutes: null, required: true, isPreview: false }])}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: C.pill, color: C.muted }}>
                <Plus className="w-3.5 h-3.5" /> Add chapter
              </button>
            </div>
          </div>
          <p className="text-xs" style={{ color: C.faint }}>
            {findingChapters ? 'Reading the chapters from the file...'
              : effectiveFormat === 'pdf'
                ? 'Chapters are read from the PDF\'s bookmarks when you upload it. If it has none, AI suggests them from the page text. Check the start pages, then save.'
                : 'Chapters are read from the file\'s table of contents or headings when you upload it. If it has none, AI suggests them. Rename or remove any you do not want, then save.'}
          </p>
          {chapters.length === 0 && <p className="text-sm py-4 text-center" style={{ color: C.faint }}>No chapters yet.</p>}
          <div className="space-y-2">
            {chapters.map((ch, i) => (
              <div key={ch.key} className="rounded-xl p-3 space-y-2" style={{ background: C.input }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs w-6 text-right shrink-0" style={{ color: C.faint }}>{i + 1}</span>
                  <input className={inputCls} style={inputStyle} value={ch.title} placeholder="Chapter title"
                    onChange={e => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, title: e.target.value } : c))} />
                  <button onClick={() => moveChapter(i, -1)} disabled={i === 0} aria-label="Move up" className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: C.muted }}><ArrowUp className="w-4 h-4" /></button>
                  <button onClick={() => moveChapter(i, 1)} disabled={i === chapters.length - 1} aria-label="Move down" className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: C.muted }}><ArrowDown className="w-4 h-4" /></button>
                  <button onClick={() => setChapters(prev => prev.filter(c => c.key !== ch.key))} aria-label="Remove chapter" className="p-1.5 rounded-lg" style={{ color: '#dc2626' }}><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap items-center gap-4 pl-8 text-xs" style={{ color: C.faint }}>
                  {effectiveFormat === 'pdf' && <>
                    <label className="flex items-center gap-1.5">Starts on page
                      <input className="w-16 rounded-lg px-2 py-1 outline-none" style={inputStyle} inputMode="numeric" value={ch.pageStart}
                        onChange={e => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, pageStart: e.target.value.replace(/\D/g, '') } : c))} />
                    </label>
                    <label className="flex items-center gap-1.5">ends on
                      <input className="w-16 rounded-lg px-2 py-1 outline-none" style={inputStyle} inputMode="numeric" value={ch.pageEnd}
                        onChange={e => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, pageEnd: e.target.value.replace(/\D/g, '') } : c))} />
                    </label>
                  </>}
                  {effectiveFormat === 'epub' && ch.href && <span className="truncate max-w-[16rem]">{ch.href}</span>}
                  {effectiveFormat === 'html' && ch.anchor && <span>#{ch.anchor}</span>}
                  <label className="flex items-center gap-2">Counts toward completion
                    <Toggle checked={ch.required} accentColor={C.cta} onChange={() => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, required: !c.required } : c))} />
                  </label>
                  {sampleSource === 'upload' && (
                    <label className="flex items-center gap-2">In the sample
                      <Toggle checked={ch.isPreview} accentColor={C.cta} onChange={() => setChapters(prev => prev.map(c => c.key === ch.key ? { ...c, isPreview: !c.isPreview } : c))} />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rights */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={card}>
          {sectionTitle('Rights')}
          <div className="grid sm:grid-cols-2 gap-5">
            {field('Licence', (
              <select className={inputCls} style={inputStyle} value={state.licenseType} onChange={e => update({ licenseType: e.target.value })}>
                <option value="">Choose a licence</option>
                {BOOK_LICENSE_TYPES.map(l => <option key={l} value={l}>{LICENSE_LABELS[l]}</option>)}
              </select>
            ), 'Required to publish.')}
            {field('Rights holder', <input className={inputCls} style={inputStyle} value={state.rightsHolder} onChange={e => update({ rightsHolder: e.target.value })} />)}
            {field('Licence link', <input className={inputCls} style={inputStyle} value={state.licenseUrl} onChange={e => update({ licenseUrl: e.target.value })} placeholder="https://" />)}
            {field('Licence ends', <input type="date" className={inputCls} style={inputStyle} value={state.licenseExpiresAt} onChange={e => update({ licenseExpiresAt: e.target.value })} />, 'Readers lose access on this date. Leave empty if it never ends.')}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm" style={{ color: C.text }}>AI may read this product to explain it and write practice questions</span>
            <Toggle checked={state.aiAllowed} accentColor={C.cta} onChange={() => update({ aiAllowed: !state.aiAllowed })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm" style={{ color: C.text }}>The author or publisher has agreed to be named on certificates</span>
            <Toggle checked={state.endorsementPermitted} accentColor={C.cta} onChange={() => update({ endorsementPermitted: !state.endorsementPermitted })} />
          </div>
        </div>

        {/* Access */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-4" style={card}>
          {sectionTitle('Who can read it')}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => update({ cohortIds: [], availableToEveryone: !state.availableToEveryone })}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: state.availableToEveryone ? C.cta : C.pill, color: state.availableToEveryone ? C.ctaText : C.muted }}>
              Everyone signed in
            </button>
            {cohorts.map(c => {
              const on = state.cohortIds.includes(c.id);
              return (
                <button key={c.id} onClick={() => update({ availableToEveryone: false, cohortIds: on ? state.cohortIds.filter(x => x !== c.id) : [...state.cohortIds, c.id] })}
                  className="px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: on ? C.cta : C.pill, color: on ? C.ctaText : C.muted }}>
                  {c.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs" style={{ color: C.faint }}>
            {state.availableToEveryone
              ? 'Free for every signed-in account.'
              : state.cohortIds.length
                ? 'Free for the selected cohorts.'
                : state.purchasable ? 'Only people who buy it.' : 'Nobody can read it yet. Choose a cohort, everyone, or sell it.'}
          </p>
        </div>

        {/* Selling */}
        <div className="rounded-2xl p-5 sm:p-7 space-y-5" style={card}>
            {sectionTitle('Selling')}
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: C.text }}>Sell this product on its own</span>
              <Toggle checked={state.purchasable} accentColor={C.cta} onChange={() => update({ purchasable: !state.purchasable })} />
            </div>
            {state.purchasable && <>
              <div className="space-y-2">
                <label className={labelCls} style={{ color: C.faint }}>Prices</label>
                {state.prices.map((p, i) => {
                  const set = (patch: Partial<EditorState['prices'][number]>) => updatePrices(state.prices.map((q, j) => j === i ? { ...q, ...patch } : q));
                  const saleTooHigh = !!p.saleAmount && !!p.amount && !(Number(p.saleAmount) < Number(p.amount));
                  return (
                    <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: C.input }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="w-24 rounded-lg px-3 py-2 text-sm outline-none uppercase" style={inputStyle} maxLength={3} placeholder="GHS" aria-label="Currency" value={p.currency}
                          onChange={e => set({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                        <input className="w-32 rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} inputMode="decimal" placeholder="0.00" aria-label="Price" value={p.amount}
                          onChange={e => set({ amount: e.target.value.replace(/[^0-9.]/g, '') })} />
                        <button onClick={() => updatePrices(state.prices.filter((_, j) => j !== i))} aria-label="Remove price" className="p-1.5 ml-auto" style={{ color: '#dc2626' }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: C.faint }}>
                        <label className="flex items-center gap-2">Sale price
                          <input className="w-28 rounded-lg px-3 py-1.5 text-sm outline-none" style={inputStyle} inputMode="decimal" placeholder="Optional" value={p.saleAmount}
                            onChange={e => set({ saleAmount: e.target.value.replace(/[^0-9.]/g, '') })} />
                        </label>
                        {p.saleAmount && (
                          <label className="flex items-center gap-2">until
                            <input type="date" className="rounded-lg px-3 py-1.5 text-sm outline-none" style={inputStyle} value={p.saleEndsAt}
                              onChange={e => set({ saleEndsAt: e.target.value })} />
                          </label>
                        )}
                        {p.saleAmount && !p.saleEndsAt && <span>No end date: the sale runs until you remove it.</span>}
                      </div>
                      {saleTooHigh && <p className="text-xs" style={{ color: '#dc2626' }}>The sale price must be lower than the regular price, or it is ignored.</p>}
                    </div>
                  );
                })}
                <button onClick={() => updatePrices([...state.prices, { currency: '', amount: '', saleAmount: '', saleEndsAt: '' }])} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.cta }}>
                  <Plus className="w-3.5 h-3.5" /> Add a price
                </button>
              </div>
              {field('Author royalty (%)', <input className={`${inputCls} max-w-[8rem]`} style={inputStyle} inputMode="decimal" value={state.royaltyPct}
                onChange={e => update({ royaltyPct: e.target.value.replace(/[^0-9.]/g, '') })} />, 'Recorded on each sale, so changing it later never rewrites past sales.')}
            </>}
          </div>
      </div>

      {/* Actions */}
      <div className="fixed bottom-0 inset-x-0 z-20" style={{ background: C.card, boxShadow: '0 -4px 20px rgba(0,0,0,0.06)' }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-end gap-2">
          {status === 'published' && (
            <button onClick={() => save('archived')} disabled={!!saving || blocked} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: C.pill, color: C.muted }}>
              {saving === 'archived' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Archive'}
            </button>
          )}
          <button onClick={() => save(status === 'published' ? 'published' : 'draft')} disabled={!!saving || !!uploading || blocked}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: C.pill, color: C.text }}>
            {saving && saving !== 'archived' && saving === (status === 'published' ? 'published' : 'draft') ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'published' ? 'Save changes' : 'Save draft'}
          </button>
          {status !== 'published' && (
            <button onClick={() => save('published')} disabled={!!saving || !!uploading || blocked} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: C.cta, color: C.ctaText }}>
              {saving === 'published' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {coverOpen && (
        <ImageLibrary uploadFolder="book-covers" initialFolder="book-covers"
          onSelect={v => update({ coverImage: v })} onClose={() => setCoverOpen(false)} />
      )}
    </div>
  );
}
