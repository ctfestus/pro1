'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { sanitizePlainText } from '@/lib/sanitize';
import {
  PROMO_PLACEMENTS, PROMO_RESHOW_OPTIONS, EVENT_FORMATS, MAX_EVENT_ITEMS, safePromoUrl, upcomingEventItems, eventsPromoCanShow,
  type PromoPlacement, type PromoKind, type PromoEventItem,
} from '@/lib/promotions';
import { PromoContent } from '@/components/PromoCard';
import { DateField, DateTimeField } from '@/components/DatePicker';
import { MenuSelect } from '@/components/MenuSelect';
import { Card, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { CoverField, EditorHeader, FIELD, Hint, Label, Sect, SwitchRow, TickList, inputStyle, useEditorC } from '@/components/create/EditorKit';

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type AudienceOption = { id: string; name: string; kind: 'bootcamp' | 'plan' };

const emptyEventItem = (): PromoEventItem => ({ date: '', format: 'virtual', title: '', note: '', url: '' });

export default function CreatePromotionPage() {
  const C = useEditorC();
  const router = useRouter();

  const [editId, setEditId]         = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const [kind, setKind]             = useState<PromoKind>('standard');
  const [eventItems, setEventItems] = useState<PromoEventItem[]>([emptyEventItem()]);
  const [title, setTitle]           = useState('');
  const [body, setBody]             = useState('');
  const [imageUrl, setImageUrl]     = useState('');
  const [ctaLabel, setCtaLabel]     = useState('');
  const [ctaUrl, setCtaUrl]         = useState('');
  const [placements, setPlacements] = useState<PromoPlacement[]>(['landing', 'student', 'course']);
  const [isActive, setIsActive]     = useState(true);
  const [reshowAfterDays, setReshowAfterDays] = useState<number | null>(null);
  const [startsAt, setStartsAt]     = useState(() => toDatetimeLocalValue(new Date()));
  const [endsAt, setEndsAt]         = useState('');
  const [audience, setAudience]     = useState<AudienceOption[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);

  const togglePlacement = (id: PromoPlacement) =>
    setPlacements(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const updateEventItem = (index: number, patch: Partial<PromoEventItem>) =>
    setEventItems(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
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

      // Bootcamp intakes, plus subscription plans (each plan has its own access cohort) so a
      // promo can target paying subscribers of one plan.
      const [{ data: cohorts }, { data: plans }] = await Promise.all([
        supabase.from('cohorts').select('id, name, cohort_kind').in('cohort_kind', ['bootcamp', 'subscription_plan']).order('name'),
        supabase.from('subscription_plans').select('name, cohort_id').eq('status', 'active'),
      ]);
      const planNames = new Map((plans ?? []).map((p: any) => [p.cohort_id, p.name]));
      setAudience((cohorts ?? []).flatMap((c: any): AudienceOption[] => {
        if (c.cohort_kind === 'bootcamp') return [{ id: c.id, name: c.name, kind: 'bootcamp' }];
        const planName = planNames.get(c.id);
        return planName ? [{ id: c.id, name: planName, kind: 'plan' }] : [];
      }));

      if (id) {
        const { data } = await supabase.from('promotions').select('*').eq('id', id).single();
        if (data) {
          setKind(data.kind === 'events' ? 'events' : 'standard');
          if (Array.isArray(data.event_items) && data.event_items.length) {
            setEventItems(data.event_items.map((x: any) => ({ ...emptyEventItem(), ...x })));
          }
          setTitle(data.title ?? '');
          setBody(data.body ?? '');
          setImageUrl(data.image_url ?? '');
          setCtaLabel(data.cta_label ?? '');
          setCtaUrl(data.cta_url ?? '');
          setPlacements(data.placements ?? []);
          setIsActive(data.is_active ?? true);
          setReshowAfterDays(data.reshow_after_days ?? null);
          if (data.starts_at) setStartsAt(toDatetimeLocalValue(new Date(data.starts_at)));
          if (data.ends_at) setEndsAt(toDatetimeLocalValue(new Date(data.ends_at)));
          setSelectedCohortIds(data.cohort_ids ?? []);
        }
      }
    };
    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError(kind === 'events' ? 'Name is required.' : 'Title is required.'); return; }
    const cleanItems = eventItems
      .map(item => ({ ...item, title: item.title.trim(), note: item.note.trim(), url: item.url.trim() }))
      .filter(item => item.date || item.title || item.note || item.url);
    if (kind === 'events') {
      if (cleanItems.length === 0) { setError('Add at least one event.'); return; }
      if (cleanItems.some(item => !item.date || !item.title)) { setError('Every event needs a date and a title.'); return; }
      if (cleanItems.some(item => item.url && !safePromoUrl(item.url))) { setError('Event links must start with https:// or with / for a page on this site.'); return; }
    }
    if (placements.length === 0) { setError('Pick at least one place to show this promotion.'); return; }
    if (kind === 'standard' && imageUrl.trim() && !safePromoUrl(imageUrl)) { setError('Image must be an https:// link or an image on this site.'); return; }
    if (kind === 'standard' && ctaUrl.trim() && !safePromoUrl(ctaUrl)) { setError('Button link must start with https:// or with / for a page on this site.'); return; }
    if (kind === 'standard' && ctaLabel.trim() && !ctaUrl.trim()) { setError('Add a button link, or clear the button text.'); return; }

    const startDate = new Date(startsAt);
    const endDate   = endsAt ? new Date(endsAt) : null;
    if (Number.isNaN(startDate.getTime())) { setError('Pick a valid start date.'); return; }
    if (endDate && endDate <= startDate) { setError('End date must be after the start date.'); return; }
    // A live events promo must be able to appear: at least one event on or after today and the
    // start date. A paused one may be saved regardless, so an old promo can still be edited or
    // switched off.
    if (kind === 'events' && isActive && !eventsPromoCanShow(cleanItems, startDate)) {
      setError('Every event is before the start date or has already passed, so this promo would never show. Change a date, or turn Live off to save it paused.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        kind, event_items: kind === 'events' ? cleanItems : [],
        // An events promo shows only its event cards; the standard-only fields are not saved.
        title: trimmedTitle,
        body: kind === 'standard' ? body.trim() || null : null,
        image_url: kind === 'standard' ? imageUrl.trim() || null : null,
        cta_label: kind === 'standard' ? ctaLabel.trim() || null : null,
        cta_url: kind === 'standard' ? ctaUrl.trim() || null : null,
        placements, cohort_ids: selectedCohortIds, is_active: isActive, reshow_after_days: reshowAfterDays,
        starts_at: startDate.toISOString(), ends_at: endDate ? endDate.toISOString() : null,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { error: e } = editId
        ? await supabase.from('promotions').update(payload).eq('id', editId)
        : await supabase.from('promotions').insert({ ...payload, author_id: session.user.id });
      if (e) throw e;

      router.push('/dashboard#promotions');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const P = palette(C);
  const field = inputStyle(C);
  const onPanel = { ...field, background: C.card };

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      <form onSubmit={handleSubmit} noValidate className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <EditorHeader C={C} back="All promotions" onBack={() => router.push('/dashboard#promotions')}
          title={title.trim() || (editId ? 'Edit promotion' : 'New promotion')}
          pill={isActive ? <Pill tone="good" dot C={C}>Live</Pill> : <Pill tone="mute" C={C}>Paused</Pill>}
          error={error} onDismissError={() => setError('')}
          actions={
            <button type="submit" disabled={loading} className={btnClass} style={btnStyle('pri', C)}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Saving...' : 'Save'}
            </button>
          } />

        <div className="mt-4 grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Preview: drawn by the same component visitors see. Beside the form on a wide screen,
              above it on a phone, so it is in view while typing. */}
          <Card C={C} className="lg:order-2 lg:sticky lg:top-4">
            <Sect C={C} title="Preview" first>
              <PromoContent C={C} preview promo={{
                id: 'preview', kind, updated_at: '',
                title: title.trim() || 'Your promotion title',
                body: body.trim() || null, image_url: kind === 'standard' ? imageUrl : null,
                cta_label: ctaLabel, cta_url: ctaUrl, event_items: eventItems,
              }} />
              {kind === 'events' && (upcomingEventItems(eventItems, MAX_EVENT_ITEMS).length === 0 ? (
                <p className="text-xs" style={{ color: C.muted }}>Events appear here once they have a date (today or later) and a title.</p>
              ) : !eventsPromoCanShow(eventItems, startsAt) && (
                <p className="text-xs" style={{ color: C.errorText }}>Every event is before the start date, so visitors would never see this promo.</p>
              ))}
              <p className="text-xs" style={{ color: C.muted }}>Drawn by the same card visitors see.</p>
            </Sect>
          </Card>

          <Card C={C} className="lg:order-1 min-w-0">
            <Sect C={C} title="Content" first>
              <div>
                <Label C={C}>Type</Label>
                <div role="radiogroup" aria-label="Promotion type" className="inline-flex gap-1 p-1 rounded-xl" style={{ background: C.page }}>
                  {([['standard', 'Standard'], ['events', 'Events']] as const).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)}
                      className="h-[34px] px-4 rounded-[9px] text-[13px] font-semibold"
                      style={kind === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                      {label}
                    </button>
                  ))}
                </div>
                <Hint C={C}>{kind === 'events' ? 'One card per event, with its date, for webinars and events.' : 'An image with a title, a short text, and a button.'}</Hint>
              </div>

              <div>
                <Label C={C}>{kind === 'events' ? 'Name' : 'Title'}</Label>
                <input type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                  placeholder={kind === 'events' ? 'For example October webinars' : 'For example Power BI bootcamp starts next month'} className={FIELD} style={field} maxLength={80} />
                {kind === 'events' && <Hint C={C}>Only shown in your dashboard list.</Hint>}
              </div>

              {kind === 'standard' && (
                <>
                  <div>
                    <Label C={C}>Short text</Label>
                    <textarea value={body} onChange={e => setBody(sanitizePlainText(e.target.value))}
                      placeholder="One or two sentences" className={`${FIELD} resize-y`} style={{ ...field, minHeight: 84 }} maxLength={200} />
                    <Hint C={C}>Optional. Long text is cut off after three lines.</Hint>
                  </div>
                  <CoverField C={C} label="Image" value={imageUrl} onChange={setImageUrl} placeholder="Select or upload an image. Square works best." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label C={C}>Button text</Label>
                      <input type="text" value={ctaLabel} onChange={e => setCtaLabel(sanitizePlainText(e.target.value))}
                        placeholder="For example Enrol now" className={FIELD} style={field} maxLength={30} />
                    </div>
                    <div>
                      <Label C={C}>Button link</Label>
                      <input type="text" value={ctaUrl} onChange={e => setCtaUrl(e.target.value)}
                        placeholder="/pricing or https://" className={FIELD} style={field} />
                    </div>
                  </div>
                </>
              )}

              {kind === 'events' && (
                <div>
                  <Label C={C}>Events</Label>
                  <div className="grid gap-2">
                    {eventItems.map((item, i) => (
                      <div key={i} className="rounded-xl p-3 grid gap-2" style={{ background: C.page }}>
                        <div className="flex flex-wrap gap-2 items-center">
                          <DateField className="flex-[1_1_160px] min-w-0" label={`Event ${i + 1} date`} value={item.date} onChange={date => updateEventItem(i, { date })} C={{ ...C, input: C.card }} />
                          <div className="flex-[1_1_130px] min-w-0">
                            <MenuSelect field label={`Event ${i + 1} format`} value={item.format} C={{ ...C, input: C.card }}
                              options={EVENT_FORMATS.map(f => ({ value: f.id, label: f.label }))}
                              onChange={format => updateEventItem(i, { format })} />
                          </div>
                          <button type="button" onClick={() => setEventItems(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : [emptyEventItem()])}
                            aria-label={`Remove event ${i + 1}`} title="Remove event"
                            className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <input type="text" value={item.title} onChange={e => updateEventItem(i, { title: sanitizePlainText(e.target.value) })}
                          placeholder="Event title, for example Women in Leadership" aria-label={`Event ${i + 1} title`} className={FIELD} style={onPanel} maxLength={60} />
                        <input type="text" value={item.note} onChange={e => updateEventItem(i, { note: sanitizePlainText(e.target.value) })}
                          placeholder="Note, for example Register by October 19" aria-label={`Event ${i + 1} note`} className={FIELD} style={onPanel} maxLength={60} />
                        <input type="text" value={item.url} onChange={e => updateEventItem(i, { url: e.target.value })}
                          placeholder="Registration link (optional): /page or https://" aria-label={`Event ${i + 1} link`} className={FIELD} style={onPanel} />
                      </div>
                    ))}
                  </div>
                  <Hint C={C}>Up to {MAX_EVENT_ITEMS}. Past dates hide on their own.</Hint>
                  {eventItems.length < MAX_EVENT_ITEMS && (
                    <button type="button" onClick={() => setEventItems(prev => [...prev, emptyEventItem()])} className={`${btnSmClass} mt-3`} style={btnStyle('sec', C)}>
                      <Plus className="w-3.5 h-3.5" /> Add event
                    </button>
                  )}
                </div>
              )}
            </Sect>

            <Sect C={C} title="Where it shows">
              <TickList C={C} items={PROMO_PLACEMENTS.map(p => ({ id: p.id, name: p.label, sub: p.hint }))}
                selected={placements} onToggle={id => togglePlacement(id as PromoPlacement)} />
            </Sect>

            <Sect C={C} title="When it shows">
              <SwitchRow C={C} title="Live" sub="Turn off to pause it without deleting." on={isActive} onChange={setIsActive} />
              <div>
                <Label C={C}>Show again after closing</Label>
                <MenuSelect field label="Show again after closing" value={reshowAfterDays === null ? '' : String(reshowAfterDays)} C={C}
                  options={PROMO_RESHOW_OPTIONS.map(o => ({ value: o.days === null ? '' : String(o.days), label: o.label }))}
                  onChange={v => setReshowAfterDays(v ? Number(v) : null)} />
                <Hint C={C}>When someone closes this promo, how long until they see it again. Never means it stays closed for them.</Hint>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label C={C}>Starts</Label>
                  <DateTimeField label="Starts" value={startsAt} onChange={setStartsAt} C={C} />
                </div>
                <div>
                  <Label C={C}>Ends</Label>
                  <DateTimeField label="Ends" placeholder="No end" value={endsAt} onChange={setEndsAt} defaultTime="23:59" C={C} />
                </div>
              </div>
            </Sect>

            {audience.length > 0 && (
              <Sect C={C} title="Who sees it" aside={selectedCohortIds.length ? `${selectedCohortIds.length} selected` : 'Everyone'}>
                <p className="text-xs" style={{ color: C.muted }}>
                  Leave all unticked to show it to everyone, including visitors who are not signed in. Ticking any limits it to students in those cohorts or plans, and it then never shows to signed-out visitors.
                </p>
                <TickList C={C} items={audience.map(a => ({ id: a.id, name: a.name, extra: a.kind === 'plan' ? 'Subscription plan' : 'Cohort' }))}
                  selected={selectedCohortIds} onToggle={toggleCohort} />
              </Sect>
            )}
          </Card>
        </div>
      </form>
    </div>
  );
}
