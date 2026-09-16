'use client';

// The AI limits tab: every AI feature, and what each plan gets of it.
//
// Owns its own load and save, so a branding save can never carry a limit change nobody made, and
// vice versa.

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import {
  AI_FEATURES,
  AI_LIMIT_DEFAULTS,
  validateAiLimit,
  type AiFeatureKey,
  type AiLimits,
  type AiTier,
} from '@/lib/ai-limits';

/**
 * Held as text, not numbers.
 *
 * A number input is a string while it is being edited -- clearing it to type a new value gives an
 * empty string, and forcing that into a number field means either a cast or a zero the admin did
 * not type. Parsing once, at save, keeps the editing honest and the validation in one place.
 */
type Draft = Record<AiFeatureKey, { free: string; paid: string }>;

const TIERS: { id: AiTier; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'paid', label: 'Paid' },
];

const asDraft = (limits: AiLimits): Draft =>
  Object.fromEntries(AI_FEATURES.map(f => [f.key, {
    free: String(limits[f.key].free),
    paid: String(limits[f.key].paid),
  }])) as Draft;

const DEFAULT_DRAFT = asDraft(AI_LIMIT_DEFAULTS);

export function AiFeaturesTab({ C }: { C: typeof LIGHT_C }) {
  const [draft, setDraft]     = useState<Draft>(DEFAULT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoadError(true); return; }
      const res = await fetch('/api/ai-limits', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) { setLoadError(true); return; }
      const json = await res.json();
      setDraft(asDraft(json.limits ?? AI_LIMIT_DEFAULTS));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    // Checked here so the message can name the feature the admin is looking at. The route
    // validates again and is the one that actually decides -- this only saves them a round trip.
    const bad = AI_FEATURES.filter(f =>
      validateAiLimit(f.key, draft[f.key].free) === null || validateAiLimit(f.key, draft[f.key].paid) === null);
    if (bad.length) {
      setMsg({ ok: false, text: `Check ${bad.map(f => f.label).join(', ')}. Each must be a whole number from 0 to its maximum.` });
      setTimeout(() => setMsg(null), 8000);
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const payload = Object.fromEntries(AI_FEATURES.map(f => [f.key, {
        free: Number(draft[f.key].free),
        paid: Number(draft[f.key].paid),
      }]));
      const res = await fetch('/api/ai-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setMsg({ ok: true, text: 'AI limits saved. They apply across the platform within 60 seconds.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 6000);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.faint }}/>
    </div>
  );

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
      <p className="text-sm max-w-xs" style={{ color: C.muted }}>Could not load AI limits. Check your connection and try again.</p>
      <button onClick={load}
        className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
        style={{ background: C.cta, color: C.ctaText }}>Retry</button>
    </div>
  );

  const changed = AI_FEATURES.some(f =>
    draft[f.key].free !== DEFAULT_DRAFT[f.key].free || draft[f.key].paid !== DEFAULT_DRAFT[f.key].paid);

  const cell = (key: AiFeatureKey, tier: AiTier, max: number) => (
    <input
      id={`ai-${key}-${tier}`}
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={draft[key][tier]}
      onChange={e => setDraft(prev => ({ ...prev, [key]: { ...prev[key], [tier]: e.target.value } }))}
      className="w-full sm:w-20 px-3 py-2 rounded-xl text-sm outline-none text-right"
      style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
    />
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 space-y-5" style={{ ...cardStyle(C) }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.faint }}>AI features</h2>
          <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
            What each learner on that plan gets, per learner and not shared across your platform.
            Set a number to 0 to close that feature on that plan. Changing a number does not reset
            anyone who has already spent: a lower limit applies from their next request, a higher
            one applies straight away.
          </p>
        </div>

        {/* Column headers, on wide screens only. On a phone each row carries its own labels, which
            reads better than a header scrolled far above the fields it names. */}
        <div className="hidden sm:grid sm:grid-cols-[1fr_5rem_5rem] sm:gap-4">
          <span />
          {TIERS.map(t => (
            <span key={t.id} className="text-[10px] font-bold uppercase tracking-widest text-right" style={{ color: C.faint }}>
              {t.label}
            </span>
          ))}
        </div>

        <div className="space-y-4">
          {AI_FEATURES.map(f => (
            <div key={f.key} className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_5rem_5rem] sm:items-start sm:gap-4">
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: C.muted }}>{f.label}</p>
                <p className="text-[11px] leading-relaxed" style={{ color: C.faint }}>
                  {f.hint} Counted {f.window === 'hour' ? 'per hour' : 'per day'}, per learner.
                  You can set up to {f.max}.
                </p>
              </div>
              {TIERS.map(t => (
                <div key={t.id} className="flex items-center gap-2 sm:block">
                  <label htmlFor={`ai-${f.key}-${t.id}`} className="text-[11px] w-10 sm:hidden" style={{ color: C.faint }}>{t.label}</label>
                  {cell(f.key, t.id, f.max)}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* The one number an admin cannot change here, said plainly rather than left a mystery. */}
        <div className="text-[11px] leading-relaxed px-3 py-2.5 rounded-xl" style={{ background: C.pill, color: C.muted }}>
          The lesson tutor also has platform-wide ceilings shared by everyone, set in environment
          configuration rather than here. They exist to stop a runaway loop draining the AI account,
          so they are deliberately not editable from a form.
        </div>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-xl ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}
          style={{ background: msg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)' }}>
          {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>}
          {msg.text}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto"/> : 'Save AI limits'}
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_DRAFT)}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 flex items-center gap-1.5"
            style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <RotateCcw className="w-3.5 h-3.5"/> Reset
          </button>
        )}
      </div>
    </div>
  );
}
