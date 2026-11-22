'use client';

// Lightweight, group-members-only chat for a group assignment: ONE conversation (no topics), styled
// as a messaging app - your messages on the right, everyone else's on the left with an avatar +
// name. Talks only to /api/assignments/group-forum (DB-derived ancestry auth + RLS behind it). The
// backend still models this as a single "thread" per group+assignment; students never see topics -
// the first message quietly starts the conversation, everyone after adds to it.
//
// Replies post optimistically; polling is adaptive (fast while the tab is visible, slow when idle,
// paused when hidden/offline) via an (updatedAt,id) cursor so edits and deletions of messages
// already on screen are reflected, not just new ones.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Send, Loader2, Trash2, Pencil, AlertCircle, RefreshCw, Check, BarChart2, Plus, X, Bold, Italic, Strikethrough, Code2, Link as LinkIcon, List, ListOrdered, Quote, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';

interface PollData { question: string; options: string[]; counts: number[]; totalVotes: number; myVote: number | null; }
interface Member { id: string; name?: string | null; avatar?: string | null; }
interface Thread { id: string; authorId: string | null; }
interface Post { id: string; authorId: string | null; authorName: string | null; authorAvatar?: string | null; body: string | null; kind?: 'text' | 'poll'; poll?: PollData | null; createdAt: string; updatedAt: string; deleted: boolean; edited: boolean; _optimistic?: boolean; _failed?: boolean; }

const POLL_ACTIVE = 3000;
const POLL_IDLE = 15000;
const IDLE_AFTER = 60000;       // no interaction for 1 min -> idle cadence
const GROUP_WINDOW = 5 * 60000; // consecutive messages from one author within 5 min group together
const POLL_MAX_OPTIONS = 6;     // keep in step with the route/DB cap
const THREAD_TITLE = 'Group discussion'; // internal container title; never shown to students

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function shortTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Inline formatting (Slack-style) for a single line: **bold**, *italic*, ~~strike~~, `code`,
// [text](url), and bare URLs. Everything is emitted through React (so text is escaped) and links are
// constrained to http(s) by the pattern - no raw HTML is ever inserted, so there is no injection
// surface. Not nested (bold inside a link etc. is not parsed), which is plenty for a chat.
const INLINE_MD_SRC = '(`[^`\\n]+`)|(\\*\\*[^*\\n]+\\*\\*)|(~~[^~\\n]+~~)|(\\*[^*\\n]+\\*)|(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^)\\s]+\\))|(https?:\\/\\/[^\\s]+)';
function renderInline(text: string, C: typeof LIGHT_C, kp: string): ReactNode[] {
  const re = new RegExp(INLINE_MD_SRC, 'g');
  const out: ReactNode[] = [];
  const linkStyle = { color: C.green, textDecoration: 'underline', wordBreak: 'break-word' as const };
  const codeStyle = { background: C.card, padding: '1px 5px', borderRadius: 5, fontSize: '0.85em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } as const;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={`${kp}-${k++}`}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok[0] === '`') out.push(<code key={`${kp}-${k++}`} style={codeStyle}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={`${kp}-${k++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('~~')) out.push(<del key={`${kp}-${k++}`} style={{ opacity: 0.75 }}>{tok.slice(2, -2)}</del>);
    else if (tok[0] === '*') out.push(<em key={`${kp}-${k++}`}>{tok.slice(1, -1)}</em>);
    else if (tok[0] === '[') {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
      out.push(mm
        ? <a key={`${kp}-${k++}`} href={mm[2]} target="_blank" rel="noreferrer" style={linkStyle}>{mm[1]}</a>
        : <span key={`${kp}-${k++}`}>{tok}</span>);
    } else out.push(<a key={`${kp}-${k++}`} href={tok} target="_blank" rel="noreferrer" style={linkStyle}>{tok}</a>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<span key={`${kp}-${k++}`}>{text.slice(last)}</span>);
  return out;
}

// Full message renderer: block level (bulleted/numbered lists, blockquotes, fenced code) built from
// consecutive matching lines, each line's text run through renderInline. Same safety as renderInline
// - all content flows through React, links are http(s)-only, no raw HTML is inserted.
function RichText({ text, C }: { text: string; C: typeof LIGHT_C }) {
  const lines = text.split('\n');
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const blocks: ReactNode[] = [];
  const isBlockStart = (ln: string) => /^\s*([-*]\s+|\d+\.\s+|>\s?|```)/.test(ln);
  let i = 0, b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {                       // fenced code block
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { buf.push(lines[i]); i++; }
      i++; // consume the closing fence if present
      blocks.push(<pre key={b++} style={{ margin: '4px 0', padding: '8px 10px', borderRadius: 8, background: C.card, overflowX: 'auto', fontSize: '0.85em', fontFamily: mono }}>{buf.join('\n')}</pre>);
    } else if (/^\s*[-*]\s+/.test(line)) {                          // bulleted list
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      blocks.push(<ul key={b++} style={{ margin: '2px 0', paddingLeft: 20, listStyleType: 'disc' }}>{items.map((it, j) => <li key={j} style={{ margin: '1px 0' }}>{renderInline(it, C, `${b}-${j}`)}</li>)}</ul>);
    } else if (/^\s*\d+\.\s+/.test(line)) {                         // numbered list
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      blocks.push(<ol key={b++} style={{ margin: '2px 0', paddingLeft: 22, listStyleType: 'decimal' }}>{items.map((it, j) => <li key={j} style={{ margin: '1px 0' }}>{renderInline(it, C, `${b}-${j}`)}</li>)}</ol>);
    } else if (/^\s*>\s?/.test(line)) {                             // blockquote
      const items: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { items.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push(<blockquote key={b++} style={{ margin: '2px 0', paddingLeft: 10, borderLeft: `3px solid ${C.green}66`, color: C.muted }}>{items.map((it, j) => <div key={j}>{renderInline(it, C, `${b}-${j}`)}</div>)}</blockquote>);
    } else {                                                        // paragraph (preserves line breaks)
      const para: string[] = [];
      while (i < lines.length && !isBlockStart(lines[i])) { para.push(lines[i]); i++; }
      blocks.push(<p key={b++} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{para.map((ln, j) => <span key={j}>{renderInline(ln, C, `${b}-${j}`)}{j < para.length - 1 ? '\n' : ''}</span>)}</p>);
    }
  }
  return <>{blocks}</>;
}

function Avatar({ name, src, size = 30, C }: { name?: string | null; src?: string | null; size?: number; C: typeof LIGHT_C }) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (src) return (
    <img src={src} alt={name || ''} width={size} height={size} className="flex-shrink-0 rounded-full object-cover" style={{ width: size, height: size }}/>
  );
  return (
    <div className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42, background: C.pill, color: C.muted }}>
      {initial}
    </div>
  );
}

// Overlapping stack of member photos (a facepile) for the channel header. Each avatar overlaps the
// previous by ~40% with a window-colored ring cutting the gap; beyond a cap it shows a "+N" chip.
function Facepile({ members, C, size = 28, max = 5 }: { members: Member[]; C: typeof LIGHT_C; size?: number; max?: number }) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  const overlap = Math.round(size * 0.4);
  const ring = `0 0 0 2px ${C.card}`;
  return (
    <div className="flex items-center flex-shrink-0">
      {shown.map((m, i) => (
        <div key={m.id} className="rounded-full flex" style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: shown.length - i, boxShadow: ring }}>
          <Avatar name={m.name} src={m.avatar} size={size} C={C}/>
        </div>
      ))}
      {extra > 0 && (
        <div className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
          style={{ marginLeft: -overlap, zIndex: 0, width: size, height: size, fontSize: size * 0.34, background: C.pill, color: C.muted, boxShadow: ring }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

// A poll rendered inside the conversation: the question plus tappable options with live result bars.
// Your current choice is highlighted; tapping another option changes your vote. Counts only - who
// voted for what is never sent to the client.
function PollCard({ poll, onVote, canManage, onDelete, C }: {
  poll: PollData; onVote: (i: number) => void; canManage: boolean; onDelete: () => void; C: typeof LIGHT_C;
}) {
  const total = poll.totalVotes;
  const voted = poll.myVote != null;
  const lead = voted ? Math.max(...poll.counts, 0) : -1; // top count, to accent the leading option
  return (
    <div className="rounded-2xl" style={{ background: C.pill, border: `1px solid ${C.divider}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '12px 14px' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: C.green }}>
          <BarChart2 className="w-3 h-3"/> Poll
        </span>
        {canManage && (
          <button onClick={onDelete} title="Delete poll" className="w-6 h-6 -mr-1 rounded flex items-center justify-center"
            style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer' }}><Trash2 className="w-3.5 h-3.5"/></button>
        )}
      </div>
      <p className="text-[15px] font-bold leading-snug mb-2.5 break-words whitespace-pre-wrap" style={{ color: C.text }}>{poll.question}</p>
      <div className="flex flex-col gap-2">
        {poll.options.map((opt, i) => {
          const c = poll.counts[i] ?? 0;
          const pct = total ? Math.round((c / total) * 100) : 0;
          const picked = poll.myVote === i;
          const leading = voted && c > 0 && c === lead;
          return (
            <button key={i} onClick={() => onVote(i)} className={`gf-poll-opt relative w-full text-left overflow-hidden${picked ? ' is-picked' : ''}`}
              style={{ borderRadius: 12, border: `2px solid ${picked ? C.green : 'transparent'}`, background: C.card,
                boxShadow: `0 2px 0 ${C.divider}`, padding: 0, cursor: 'pointer' }}>
              {/* result fill: revealed only after voting, grows from the left with a rounded right end
                 (width-based, since scaleX would distort the corner radius) */}
              {voted && <div aria-hidden className="gf-poll-fill" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, borderRadius: '0 10px 10px 0', background: picked ? `${C.green}3d` : `${C.green}17` }}/>}
              <div className="relative flex items-center gap-2.5 px-3 py-2.5">
                <span className="flex-shrink-0 flex items-center justify-center rounded-full" style={{ width: 18, height: 18, border: `2px solid ${picked ? C.green : C.faint}`, background: picked ? C.green : 'transparent', transition: 'background .15s, border-color .15s' }}>
                  {picked && <Check className="w-3 h-3" strokeWidth={3} style={{ color: '#fff' }}/>}
                </span>
                <span className="flex-1 text-[13px] font-semibold break-words" style={{ color: C.text }}>{opt}</span>
                {voted && <span className="flex-shrink-0 text-[12px] font-extrabold" style={{ color: picked || leading ? C.green : C.muted, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] font-medium mt-2" style={{ color: C.faint }}>
        {total} {total === 1 ? 'vote' : 'votes'}{voted ? ' - tap another to change' : ' - tap to vote'}
      </p>
    </div>
  );
}

export function GroupForum({ assignmentId, groupId, userId, C, onBack, members = [] }: { assignmentId: string; groupId: string; userId: string; C: typeof LIGHT_C; onBack?: () => void; members?: Member[] }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMoreEarlier, setHasMoreEarlier] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const pollCursor = useRef<string | null>(null);

  const [reply, setReply] = useState('');
  const [actionError, setActionError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [online, setOnline] = useState(true);

  // poll composer
  const [showPoll, setShowPoll] = useState(false);
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState<string[]>(['', '']);
  const [creatingPoll, setCreatingPoll] = useState(false);

  const lastActivity = useRef<number>(Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true); // keep pinned to the newest message unless the user scrolls up
  const knownIds = useRef<Set<string>>(new Set()); // ids on screen; poll auto-scroll only for NEW ones
  const mounted = useRef(true);
  // Set true on (re)mount, not just once: React StrictMode (dev) mounts -> unmounts -> remounts, and
  // without re-setting here the ref stays false after that first unmount, so every post-await setState
  // is skipped and the UI hangs on "Loading...".
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Grow the composer with its content so multi-line messages and continued lists stay visible
  // (a fixed one-row box hides everything past the first line).
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [reply, showPoll]);
  // Track which post ids are on screen, so polling can tell a NEW message from an in-place update
  // (an edit, deletion, or vote tally on an existing post) and only auto-scroll for the former.
  useEffect(() => { knownIds.current = new Set(posts.map(p => p.id)); }, [posts]);

  const touch = () => { lastActivity.current = Date.now(); };
  const scrollToBottom = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  const onScroll = () => { const el = scrollRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/assignments/group-forum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json?.error || 'Request failed'), { status: res.status });
    return json;
  }, []);

  const loadPosts = useCallback(async (t: Thread) => {
    const json = await call({ action: 'listPosts', threadId: t.id, mode: 'initial' });
    if (!mounted.current) return;
    setPosts(json.posts); setHasMoreEarlier(!!json.hasMoreEarlier); setOlderCursor(json.olderCursor ?? null);
    pollCursor.current = json.pollCursor ?? null;
    setTimeout(scrollToBottom, 0);
  }, [call]);

  // The group's single conversation lives in the most-recent (only) thread; adopt it if present.
  const findThread = useCallback(async (): Promise<Thread | null> => {
    const json = await call({ action: 'listThreads', assignmentId, groupId });
    const t = (json.threads ?? [])[0];
    return t ? { id: t.id, authorId: t.authorId } : null;
  }, [assignmentId, groupId, call]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const t = await findThread();
        if (!mounted.current) return;
        setThread(t);
        if (t) await loadPosts(t);
        if (mounted.current) setError('');
      } catch (e: any) {
        if (mounted.current) setError(e?.message || 'Could not load the discussion.');
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [findThread, loadPosts]);

  const loadEarlier = useCallback(async () => {
    if (!thread || !olderCursor) return;
    touch();
    try {
      const json = await call({ action: 'listPosts', threadId: thread.id, mode: 'earlier', cursor: olderCursor });
      if (!mounted.current) return;
      setPosts(prev => [...json.posts, ...prev]);
      setHasMoreEarlier(!!json.hasMoreEarlier); setOlderCursor(json.olderCursor ?? null);
    } catch { /* leave as-is */ }
  }, [thread, olderCursor, call]);

  // ---- adaptive polling ----
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') touch(); };
    const onOnline = () => setOnline(navigator.onLine);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOnline);
    setOnline(navigator.onLine);
    let timer: any;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && navigator.onLine) {
        try {
          if (thread) {
            const json = await call({ action: 'listPosts', threadId: thread.id, mode: 'poll', cursor: pollCursor.current ?? undefined });
            if (mounted.current && json.posts?.length) {
              const incoming = json.posts as Post[];
              // A new message (unseen id) is worth scrolling to; an in-place update to a post already
              // on screen (edit, deletion, or a vote changing a poll's tally) is not.
              const hasNewMessage = incoming.some(p => !knownIds.current.has(p.id));
              setPosts(prev => {
                const byId = new Map(prev.map(p => [p.id, p]));
                for (const p of incoming) byId.set(p.id, p);
                return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
              });
              if (hasNewMessage && stick.current) setTimeout(scrollToBottom, 0);
            }
            if (json?.pollCursor) pollCursor.current = json.pollCursor;
          } else {
            // No conversation yet - has a groupmate just started one?
            const t = await findThread();
            if (t && mounted.current) { setThread(t); await loadPosts(t); }
          }
        } catch { /* transient */ }
      }
      const idle = Date.now() - lastActivity.current > IDLE_AFTER || document.visibilityState !== 'visible';
      timer = setTimeout(tick, idle ? POLL_IDLE : POLL_ACTIVE);
    };
    timer = setTimeout(tick, POLL_ACTIVE);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline); };
  }, [thread, call, findThread, loadPosts]);

  // ---- send (starts the conversation on the first message) ----
  async function send() {
    const body = reply.trim();
    if (!body) return;
    touch();
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const optimistic: Post = { id: tempId, authorId: userId, authorName: 'You', body, createdAt: now, updatedAt: now, deleted: false, edited: false, _optimistic: true };
    setPosts(prev => [...prev, optimistic]); setReply(''); setActionError(''); stick.current = true; setTimeout(scrollToBottom, 0);
    try {
      if (!thread) {
        const json = await call({ action: 'createThread', assignmentId, groupId, title: THREAD_TITLE, body });
        if (!mounted.current) return;
        const started = { id: json.thread.id, authorId: json.thread.authorId };
        setThread(started);
        if (json.existing) {
          // Someone else started the conversation first: show all of it, not just this message.
          await loadPosts(started);
        } else {
          // Replace only this message's placeholder, so a second message sent meanwhile stays.
          setPosts(prev => prev.map(p => p.id === tempId ? json.post : p));
          pollCursor.current = null; // next poll re-syncs from the opening message
        }
      } else {
        const json = await call({ action: 'createPost', threadId: thread.id, body });
        if (!mounted.current) return;
        setPosts(prev => prev.map(p => p.id === tempId ? json.post : p));
        // Do NOT advance pollCursor here: the next poll should still pick up any edit/deletion made
        // by someone else since the last poll (those carry earlier timestamps) alongside this message.
      }
    } catch (e: any) {
      if (!mounted.current) return;
      setPosts(prev => prev.map(p => p.id === tempId ? { ...p, _failed: true } : p)); // keep the text, flagged
      setActionError(e?.message || 'Your message did not send. Tap retry.');
    }
  }

  function retryFailed(p: Post) {
    if (!p.body) return;
    setPosts(prev => prev.filter(x => x.id !== p.id));
    setReply(p.body);
  }

  async function saveEdit(p: Post) {
    const body = editDraft.trim();
    if (!body) return;
    touch(); setSavingEdit(true); setActionError('');
    try {
      const json = await call({ action: 'editPost', postId: p.id, body, expectedUpdatedAt: p.updatedAt });
      if (!mounted.current) return;
      setPosts(prev => prev.map(x => x.id === p.id ? json.post : x));
      setEditingId(null); setEditDraft('');
    } catch (e: any) {
      if (!mounted.current) return;
      if (e?.status === 409 && thread) { setActionError('That message changed - reloading.'); await loadPosts(thread); }
      else setActionError(e?.message || 'Could not save your edit.');
    } finally { if (mounted.current) setSavingEdit(false); }
  }

  async function removePost(p: Post) {
    touch(); setActionError('');
    const prev = posts;
    setPosts(cur => cur.map(x => x.id === p.id ? { ...x, deleted: true, body: null } : x)); // optimistic
    try {
      await call({ action: 'deletePost', postId: p.id, expectedUpdatedAt: p.updatedAt });
    } catch (e: any) {
      if (!mounted.current) return;
      setPosts(prev); // rollback
      if (e?.status === 409 && thread) { setActionError('That message changed - reloading.'); await loadPosts(thread); }
      else setActionError(e?.message || 'Could not delete the message.');
    }
  }

  // ---- polls ----
  const setOpt = (i: number, v: string) => setPollOpts(o => o.map((x, xi) => (xi === i ? v : x)));
  const addOpt = () => setPollOpts(o => (o.length < POLL_MAX_OPTIONS ? [...o, ''] : o));
  const removeOpt = (i: number) => setPollOpts(o => (o.length > 2 ? o.filter((_, xi) => xi !== i) : o));
  const cancelPoll = () => { setShowPoll(false); setPollQ(''); setPollOpts(['', '']); setActionError(''); };

  async function createPoll() {
    const question = pollQ.trim();
    const options = [...new Set(pollOpts.map(o => o.trim()).filter(Boolean))]; // drop blanks + duplicates
    if (!question || options.length < 2) { setActionError('A poll needs a question and at least 2 options.'); return; }
    touch(); setCreatingPoll(true); setActionError('');
    try {
      const json = await call({ action: 'createPoll', assignmentId, groupId, question, options });
      if (!mounted.current) return;
      if (json.thread) { setThread({ id: json.thread.id, authorId: json.thread.authorId }); pollCursor.current = null; }
      setPosts(prev => (prev.some(p => p.id === json.post.id) ? prev : [...prev, json.post]));
      cancelPoll();
      stick.current = true; setTimeout(scrollToBottom, 0);
    } catch (e: any) {
      if (mounted.current) setActionError(e?.message || 'Could not create the poll.');
    } finally { if (mounted.current) setCreatingPoll(false); }
  }

  async function vote(p: Post, optionIdx: number) {
    const poll = p.poll;
    if (!poll || poll.myVote === optionIdx) return; // re-tapping the same option is a no-op (no unvote in v1)
    touch(); setActionError('');
    const prevMy = poll.myVote;
    setPosts(cur => cur.map(x => { // optimistic: shift my vote, real tallies arrive on the next poll
      if (x.id !== p.id || !x.poll) return x;
      const counts = x.poll.counts.slice();
      if (prevMy != null && counts[prevMy] != null) counts[prevMy] = Math.max(0, counts[prevMy] - 1);
      counts[optionIdx] = (counts[optionIdx] ?? 0) + 1;
      return { ...x, poll: { ...x.poll, counts, totalVotes: x.poll.totalVotes + (prevMy == null ? 1 : 0), myVote: optionIdx } };
    }));
    try {
      await call({ action: 'vote', postId: p.id, optionIdx });
    } catch (e: any) {
      if (!mounted.current) return;
      setActionError(e?.message || 'Could not record your vote.');
      if (thread) await loadPosts(thread); // resync authoritative tallies
    }
  }

  // ---- composer formatting (Slack-style markdown) ----
  // Wrap the current selection in the composer with markdown markers; if nothing is selected, drop in
  // a placeholder and select it so the next keystroke replaces it.
  function surround(before: string, after = before, placeholder = 'text') {
    const el = composerRef.current;
    const s = el?.selectionStart ?? reply.length;
    const e = el?.selectionEnd ?? reply.length;
    const inner = reply.slice(s, e) || placeholder;
    const next = reply.slice(0, s) + before + inner + after + reply.slice(e);
    setReply(next); touch();
    requestAnimationFrame(() => { if (!el) return; el.focus(); const p0 = s + before.length; el.setSelectionRange(p0, p0 + inner.length); });
  }
  function insertLink() {
    const el = composerRef.current;
    const s = el?.selectionStart ?? reply.length;
    const e = el?.selectionEnd ?? reply.length;
    const label = reply.slice(s, e) || 'link text';
    const url = 'https://';
    const next = reply.slice(0, s) + `[${label}](${url})` + reply.slice(e);
    setReply(next); touch();
    requestAnimationFrame(() => { if (!el) return; el.focus(); const u0 = s + `[${label}](`.length; el.setSelectionRange(u0, u0 + url.length); });
  }
  // Prefix each selected line (expanded to whole lines) - for lists and quotes.
  function prefixLines(makePrefix: (idx: number) => string) {
    const el = composerRef.current;
    const s = el?.selectionStart ?? reply.length;
    const e = el?.selectionEnd ?? reply.length;
    const from = reply.lastIndexOf('\n', s - 1) + 1;
    const nl = reply.indexOf('\n', e);
    const to = nl === -1 ? reply.length : nl;
    const block = reply.slice(from, to).split('\n').map((ln, i) => makePrefix(i) + ln).join('\n');
    const next = reply.slice(0, from) + block + reply.slice(to);
    setReply(next); touch();
    // Collapse the caret to the END of the inserted markers (not selecting them) so the next
    // keystroke types the item content instead of overwriting the marker.
    requestAnimationFrame(() => { if (!el) return; el.focus(); const end = from + block.length; el.setSelectionRange(end, end); });
  }
  // Shift+Enter inside a list/quote item continues it (next bullet, incremented number, or quote
  // marker); on an empty item it drops the marker to end the list. Returns true when it handled the
  // newline itself (so the default line break is suppressed).
  function handleListEnter(): boolean {
    const el = composerRef.current;
    if (!el || el.selectionStart !== el.selectionEnd) return false;
    const caret = el.selectionStart ?? 0;
    const lineStart = reply.lastIndexOf('\n', caret - 1) + 1;
    const line = reply.slice(lineStart, caret);
    let indent = '', marker = '', content = '', mm: RegExpExecArray | null;
    if ((mm = /^(\s*)([-*])\s+(.*)$/.exec(line))) { indent = mm[1]; marker = `${mm[2]} `; content = mm[3]; }
    else if ((mm = /^(\s*)(\d+)\.\s+(.*)$/.exec(line))) { indent = mm[1]; marker = `${parseInt(mm[2], 10) + 1}. `; content = mm[3]; }
    else if ((mm = /^(\s*)>\s?(.*)$/.exec(line))) { indent = mm[1]; marker = '> '; content = mm[2]; }
    else return false;
    if (content.trim() === '') { // empty item -> drop the marker and end the list
      const next = reply.slice(0, lineStart) + reply.slice(caret);
      setReply(next); touch();
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart, lineStart); });
      return true;
    }
    const insert = `\n${indent}${marker}`;
    const next = reply.slice(0, caret) + insert + reply.slice(caret);
    setReply(next); touch();
    requestAnimationFrame(() => { el.focus(); const p = caret + insert.length; el.setSelectionRange(p, p); });
    return true;
  }
  const FMT_TOOLS: { icon: typeof Bold; title: string; fn: () => void }[] = [
    { icon: Bold, title: 'Bold (Ctrl/Cmd+B)', fn: () => surround('**', '**', 'bold') },
    { icon: Italic, title: 'Italic (Ctrl/Cmd+I)', fn: () => surround('*', '*', 'italic') },
    { icon: Strikethrough, title: 'Strikethrough', fn: () => surround('~~', '~~', 'strikethrough') },
    { icon: Code2, title: 'Code', fn: () => surround('`', '`', 'code') },
    { icon: LinkIcon, title: 'Link', fn: insertLink },
  ];
  const BLOCK_TOOLS: { icon: typeof Bold; title: string; fn: () => void }[] = [
    { icon: List, title: 'Bulleted list', fn: () => prefixLines(() => '- ') },
    { icon: ListOrdered, title: 'Numbered list', fn: () => prefixLines(i => `${i + 1}. `) },
    { icon: Quote, title: 'Quote', fn: () => prefixLines(() => '> ') },
  ];

  const editStyle = useMemo(() => ({ width: '100%', padding: '10px 12px', borderRadius: 12, background: C.input, color: C.text, fontSize: 14, outline: 'none', border: `1px solid ${C.divider}`, resize: 'none' } as const), [C]);
  const fieldStyle = useMemo(() => ({ width: '100%', padding: '8px 10px', borderRadius: 10, background: C.card, color: C.text, fontSize: 14, outline: 'none', border: `1px solid ${C.divider}` } as const), [C]);

  const styleTag = (
    <style>{`
      /* Rows highlight subtly on hover, revealing the grouped-line time and the author's own
         edit/delete actions. */
      .gf-msg { border-radius: 6px; }
      .gf-msg:hover { background: ${C.pill}; }
      .gf-msg .gf-actions, .gf-msg .gf-ts { opacity: 0; transition: opacity .12s; }
      .gf-msg:hover .gf-actions, .gf-msg:hover .gf-ts { opacity: 1; }
      /* Touch devices have no hover - keep the edit/delete actions and grouped time visible. */
      @media (hover: none) { .gf-msg .gf-actions, .gf-msg .gf-ts { opacity: 1; } }
      /* Duolingo-style poll options: hover hint, tactile press (the bottom edge collapses), and a
         result fill that eases in after voting. Reduced-motion users get the states without movement. */
      .gf-poll-opt { transition: transform .08s ease, box-shadow .08s ease, border-color .15s ease, background .15s ease; }
      .gf-poll-opt:not(.is-picked):hover { border-color: ${C.green} !important; }
      .gf-poll-opt:active { transform: translateY(2px); box-shadow: none !important; }
      .gf-poll-opt:focus-visible { outline: 2px solid ${C.green}; outline-offset: 2px; }
      .gf-poll-fill { transition: width .55s cubic-bezier(.22, 1, .36, 1); }
      @media (prefers-reduced-motion: reduce) {
        .gf-poll-opt, .gf-poll-fill { transition: none !important; }
        .gf-poll-opt:active { transform: none; }
      }
      /* Show focus on the whole composer pill (subtle), not the harsh global green textarea outline
         (globals.css forces a 2px !important ring that looks bad boxed inside the rounded field). */
      .gf-composer:focus-within { border-color: ${C.green} !important; box-shadow: 0 0 0 3px ${C.green}22; }
      .gf-composer textarea:focus-visible { outline: none !important; }
    `}</style>
  );

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.divider}`, boxShadow: '0 10px 34px rgba(0,0,0,0.10)', height: '80vh' }}>
      {styleTag}
      {/* Slack-style channel header */}
      <div className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.divider}` }}>
        {members.length > 0
          ? <Facepile members={members} C={C}/>
          : <span role="img" aria-label="megaphone" className="inline-flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 30, height: 30, background: `${C.green}1a`, fontSize: 17, lineHeight: 1 }}>📣</span>}
        <div className="min-w-0 leading-tight flex-1">
          <div className="text-[15px] font-bold tracking-tight truncate" style={{ color: C.text }}>Group channel</div>
          <div className="text-[11px] truncate" style={{ color: C.faint }}>{members.length > 0 ? `${members.length} ${members.length === 1 ? 'member' : 'members'} - members only` : 'Members only - plan your group work here'}</div>
        </div>
        {onBack && (
          <button onClick={onBack} title="Back to assignment" className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap" style={{ background: C.pill, color: C.muted, border: 'none', cursor: 'pointer' }}>
            <ArrowLeft className="w-3.5 h-3.5"/> <span className="hidden sm:inline">Back to assignment</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center gap-2 text-sm justify-center" style={{ color: C.muted }}><Loader2 className="w-4 h-4 animate-spin"/> Loading...</div>
      ) : error ? (
        <div className="flex-1 flex flex-wrap items-center gap-2 text-sm justify-center px-4 text-center" style={{ color: '#ef4444' }}>
          <AlertCircle className="w-4 h-4"/> {error}
          <button onClick={() => location.reload()} className="inline-flex items-center gap-1 ml-2" style={{ background: 'none', border: 'none', color: C.green, cursor: 'pointer' }}><RefreshCw className="w-3.5 h-3.5"/> Retry</button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 flex flex-col px-3 py-2" style={{ minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {hasMoreEarlier && (
              <button onClick={loadEarlier} className="text-xs font-medium mb-2 self-center" style={{ background: 'none', border: 'none', color: C.green, cursor: 'pointer', padding: '4px 8px' }}>Load earlier messages</button>
            )}

            {posts.length === 0 ? (
              <div className="flex flex-col items-center text-center gap-2 py-10 m-auto">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `${C.green}18`, fontSize: 26, lineHeight: 1 }} role="img" aria-label="megaphone">📣</div>
                <p className="text-sm font-semibold" style={{ color: C.text }}>Start the channel</p>
                <p className="text-xs max-w-xs" style={{ color: C.muted }}>Say hello, drop a link, or run a quick poll to get the group talking.</p>
              </div>
            ) : posts.map((p, i) => {
              const mine = p.authorId === userId;
              const prev = posts[i - 1];
              const grouped = !!prev && !prev.deleted && !p.deleted && prev.authorId === p.authorId
                && new Date(p.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW;

              if (editingId === p.id) return (
                <div key={p.id} className="flex flex-col gap-2 px-1 py-2 w-full">
                  <textarea value={editDraft} onChange={e => setEditDraft(e.target.value)} rows={3} style={editStyle}/>
                  <div className="flex gap-2 self-end">
                    <button onClick={() => saveEdit(p)} disabled={savingEdit} className="text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: 'pointer' }}><Check className="w-3.5 h-3.5"/> Save</button>
                    <button onClick={() => { setEditingId(null); setEditDraft(''); }} className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: C.pill, color: C.muted, border: 'none', cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              );

              if (p.deleted) return (
                <div key={p.id} className="flex" style={{ marginTop: grouped ? 2 : 12, paddingLeft: 54 }}>
                  <span className="text-xs italic" style={{ color: C.faint }}>message deleted</span>
                </div>
              );

              const isPoll = !!p.poll;
              return (
                <div key={p.id} className="gf-msg relative flex gap-3" style={{ marginTop: grouped ? 2 : 14, padding: '4px 8px 5px 6px', opacity: p._optimistic && !p._failed ? 0.6 : 1 }}>
                  {grouped
                    ? <div className="gf-ts flex-shrink-0 flex justify-end pt-0.5" style={{ width: 36 }}><span className="text-[9px]" style={{ color: C.faint }}>{shortTime(p.createdAt)}</span></div>
                    : <Avatar name={p.authorName} src={p.authorAvatar} size={36} C={C}/>}
                  <div className="flex flex-col min-w-0 flex-1">
                    {!grouped && (
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span className="text-[13px] font-bold" style={{ color: C.text }}>{mine ? 'You' : (p.authorName || 'Former member')}</span>
                        <span className="text-[10px]" style={{ color: C.faint }}>{p._failed ? 'not sent' : timeAgo(p.createdAt)}{p.edited ? ' (edited)' : ''}</span>
                      </div>
                    )}
                    {isPoll
                      ? <div style={{ maxWidth: 360 }}><PollCard poll={p.poll!} onVote={i => vote(p, i)} canManage={mine && !p._optimistic} onDelete={() => removePost(p)} C={C}/></div>
                      : <div className="text-sm break-words" style={{ color: C.text, lineHeight: 1.5 }}><RichText text={p.body || ''} C={C}/></div>}
                    {p._failed && <button onClick={() => retryFailed(p)} className="text-[11px] font-semibold self-start mt-0.5" style={{ background: 'none', border: 'none', color: C.green, cursor: 'pointer' }}>Retry</button>}
                  </div>
                  {mine && !p._optimistic && !isPoll && (
                    <div className="gf-actions absolute flex gap-1" style={{ top: 2, right: 6 }}>
                      <button onClick={() => { setEditingId(p.id); setEditDraft(p.body || ''); }} title="Edit" className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: C.card, border: `1px solid ${C.divider}`, color: C.faint, cursor: 'pointer' }}><Pencil className="w-3.5 h-3.5"/></button>
                      <button onClick={() => removePost(p)} title="Delete" className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: C.card, border: `1px solid ${C.divider}`, color: C.faint, cursor: 'pointer' }}><Trash2 className="w-3.5 h-3.5"/></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-3 pt-3 pb-3 flex-shrink-0" style={{ borderTop: `1px solid ${C.divider}` }}>
            {showPoll ? (
              <div className="rounded-2xl px-3 py-3" style={{ background: C.input, border: `1px solid ${C.divider}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold inline-flex items-center gap-1.5" style={{ color: C.text }}><BarChart2 className="w-3.5 h-3.5" style={{ color: C.green }}/> New poll</span>
                  <button onClick={cancelPoll} title="Cancel" className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}><X className="w-4 h-4"/></button>
                </div>
                <input value={pollQ} onChange={e => { setPollQ(e.target.value); touch(); }} placeholder="Ask a question..." className="mb-2" style={{ ...fieldStyle, fontWeight: 600 }}/>
                <div className="flex flex-col gap-1.5 mb-2">
                  {pollOpts.map((opt, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input value={opt} onChange={e => setOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} style={fieldStyle}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (i === pollOpts.length - 1 && pollOpts.length < POLL_MAX_OPTIONS) addOpt(); } }}/>
                      {pollOpts.length > 2 && <button onClick={() => removeOpt(i)} title="Remove option" className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style={{ background: C.pill, border: 'none', color: C.faint, cursor: 'pointer' }}><X className="w-3.5 h-3.5"/></button>}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  {pollOpts.length < POLL_MAX_OPTIONS
                    ? <button onClick={addOpt} className="text-xs font-medium inline-flex items-center gap-1" style={{ background: 'none', border: 'none', color: C.green, cursor: 'pointer' }}><Plus className="w-3.5 h-3.5"/> Add option</button>
                    : <span className="text-[10px]" style={{ color: C.faint }}>Up to {POLL_MAX_OPTIONS} options</span>}
                  <button onClick={createPoll} disabled={creatingPoll || !pollQ.trim() || pollOpts.filter(o => o.trim()).length < 2}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-40"
                    style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: 'pointer' }}>
                    {creatingPoll ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <BarChart2 className="w-3.5 h-3.5"/>} Create poll
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center flex-wrap gap-0.5 mb-1 px-0.5">
                  {[...FMT_TOOLS, null, ...BLOCK_TOOLS].map((t, idx) => {
                    if (t === null) return <span key={`sep-${idx}`} aria-hidden className="mx-1" style={{ width: 1, height: 16, background: C.divider }}/>;
                    const Icon = t.icon;
                    return (
                      <button key={t.title} type="button" title={t.title} onMouseDown={e => e.preventDefault()} onClick={t.fn}
                        className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>
                        <Icon className="w-3.5 h-3.5"/>
                      </button>
                    );
                  })}
                  <span aria-hidden className="mx-1" style={{ width: 1, height: 16, background: C.divider }}/>
                  <button type="button" onClick={() => { setShowPoll(true); touch(); }} title="Create a poll"
                    className="h-7 px-2 rounded-md inline-flex items-center gap-1 text-[11px] font-medium" style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>
                    <BarChart2 className="w-3.5 h-3.5"/> Poll
                  </button>
                </div>
                <div className="gf-composer flex items-end gap-1 rounded-2xl px-2 py-1.5" style={{ background: C.input, border: `1px solid ${C.divider}`, transition: 'border-color .12s, box-shadow .12s' }}>
                  <textarea ref={composerRef} value={reply} onChange={e => { setReply(e.target.value); touch(); }} placeholder="Message your group..." rows={1}
                    className="flex-1" style={{ background: 'transparent', color: C.text, fontSize: 14, lineHeight: 1.45, outline: 'none', border: 'none', resize: 'none', padding: '8px 6px', maxHeight: 160, overflowY: 'auto' }}
                    onKeyDown={e => {
                      const mod = e.metaKey || e.ctrlKey;
                      if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); surround('**', '**', 'bold'); return; }
                      if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); surround('*', '*', 'italic'); return; }
                      if (e.key !== 'Enter') return;
                      if (e.shiftKey) { // Shift+Enter = new line; continue a list/quote with its marker
                        if (handleListEnter()) e.preventDefault();
                        return;
                      }
                      e.preventDefault(); send(); // Enter sends
                    }}/>
                  <button onClick={send} disabled={!reply.trim()} className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: reply.trim() ? 'pointer' : 'not-allowed' }}><Send className="w-4 h-4"/></button>
                </div>
                <p className="text-[10px] mt-1.5 pl-1" style={{ color: C.faint }}>Enter to send, Shift+Enter for a new line. **bold**, *italic*, `code`, links{!online ? ' - you are offline' : ''}</p>
              </>
            )}
            {actionError && <p className="text-xs mt-1 pl-1" style={{ color: '#ef4444' }}>{actionError}</p>}
          </div>
        </>
      )}
    </div>
  );
}
