'use client';

import { useState } from 'react';
import { ArrowRight, Check, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { decideNewPlanActivation, type PlanContentChange } from '@/lib/plan-content-request';
import type { ThemeColors } from '@/lib/theme';
import { postPayments } from './api';
import { ContentPicker } from './ContentPicker';
import { freshPlanDiscount, planDiscountPayload, planPriceDrafts, pricesPayload, splitContentKey } from './drafts';
import { BUTTON, FIELD, Modal, UnsavedChangesDialog, inputStyle } from './Modal';
import { PlanDiscountFields, PlanPriceFields } from './PlanForm';
import { contentTitle, runPlanContentChanges, type AskToClosePublic } from './planContent';
import { palette } from './ui';

const STEPS = [['Details', 'Name your offer'], ['Content', 'Choose learning'], ['Pricing', 'Set purchase options']] as const;

/** Create plan in three steps: details, content, prices. Saves as a draft first, then activates. */
export function PlanBuilderModal({ contentOptions, currency, askToClosePublic, onClose, onChanged, onSaved, C }: {
  contentOptions: any[];
  currency: string;
  askToClosePublic: AskToClosePublic;
  onClose: () => void;
  /** The plans changed but the builder stays open (a draft was saved or discarded). */
  onChanged: (planId?: string) => void;
  onSaved: (message: string, planId: string) => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contentKeys, setContentKeys] = useState<string[]>([]);
  const [prices, setPrices] = useState(() => planPriceDrafts(null, currency));
  const [discount, setDiscount] = useState(freshPlanDiscount);
  // Set once the first save creates the plan, so a retry continues the same plan.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hasName = Boolean(name.trim());
  const livePrices = prices.filter((price) => price.isActive && Number(price.amount) > 0).length;
  const checks = [hasName, contentKeys.length > 0, livePrices > 0];
  const readyCount = checks.filter(Boolean).length;
  const dirty = hasName || Boolean(description.trim()) || contentKeys.length > 0 || Boolean(draftId)
    || JSON.stringify(prices) !== JSON.stringify(planPriceDrafts(null, currency))
    || JSON.stringify(discount) !== JSON.stringify(freshPlanDiscount());

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  async function discard() {
    if (!draftId) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await postPayments({ action: 'delete-subscription-plan', planId: draftId }, 'Failed to discard plan draft');
      onChanged();
      onClose();
    } catch (err: any) {
      setConfirmClose(false);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(status: 'active' | 'inactive') {
    setConfirmClose(false);
    setBusy(true);
    setError('');
    let planId = draftId;
    try {
      if (planId) {
        await postPayments({ action: 'update-subscription-plan', planId, name: name.trim(), description: description.trim(), status: 'inactive' }, 'Failed to update plan draft');
      } else {
        const data = await postPayments({ action: 'create-subscription-plan', name, description }, 'Failed to create plan');
        planId = data.planId as string | null;
        if (!planId) throw new Error('Plan draft was not created');
        setDraftId(planId);
      }
      const savedPlanId: string = planId;

      await postPayments({
        action: 'save-subscription-plan-prices',
        planId: savedPlanId,
        prices: pricesPayload(prices),
        discount: planDiscountPayload(discount),
      }, 'Failed to save plan prices');

      // Through the same path as every other caller, so this flow asks about open access rather
      // than being refused by the server for not asking.
      const requested = contentKeys.map((key) => {
        const { contentTable, contentId } = splitContentKey(key);
        return { contentTable: contentTable as PlanContentChange['contentTable'], contentId, title: contentTitle(contentOptions, contentTable, contentId) };
      });
      const contentResult = await runPlanContentChanges(
        requested.map(({ contentTable, contentId }) => ({ planId: savedPlanId, contentTable, contentId, add: true })),
        contentOptions,
        askToClosePublic,
      );

      // A plan is put on sale by activating it, and the public pricing view asks for an active
      // plan with a live price -- not for any content behind it. Activating one whose content
      // did not attach publishes something buyable and empty, so it stays a draft instead.
      const decision = decideNewPlanActivation({
        requested,
        outcomes: contentResult ? contentResult.outcomes : null,
        wantActive: status === 'active',
      });

      if (decision.tone === 'error') {
        setError(`${decision.message} Fix the issue and try again to continue this same plan.`);
        onChanged(savedPlanId);
        return;
      }
      if (decision.activate) {
        await postPayments({ action: 'update-subscription-plan', planId: savedPlanId, status: 'active' }, 'Failed to activate plan');
      }
      // One message, from one decision. Setting a success line after an error line is how a
      // partial result came to read as a finished one.
      onSaved(decision.message, savedPlanId);
    } catch (err: any) {
      setError(planId
        ? `The plan is safely saved as a draft. ${err.message} Fix the issue and try again to continue this same plan.`
        : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title="Create a subscription plan" eyebrow="Name it, choose its content, then set its prices" onClose={requestClose} C={C} error={error} wide>
        <div className="grid lg:grid-cols-[1fr_250px] gap-6">
          <div className="min-w-0">
            <div className="grid grid-cols-3 gap-2 mb-6">
              {STEPS.map(([label, helper], index) => {
                const complete = index < step;
                const current = index === step;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { if (index === 0 || hasName) setStep(index as 0 | 1 | 2); }}
                    className="rounded-2xl p-3 text-left transition-all"
                    style={{ background: C.page, boxShadow: current ? `inset 0 0 0 2px ${P.sel}` : 'none' }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold"
                        style={{ background: complete || current ? P.sel : C.card, color: complete || current ? P.onSel : C.faint }}
                      >
                        {complete ? <Check className="w-3.5 h-3.5" /> : index + 1}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: C.text }}>{label}</span>
                    </span>
                    <span className="hidden sm:block text-[11px] mt-2" style={{ color: C.faint }}>{helper}</span>
                  </button>
                );
              })}
            </div>

            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-base font-bold leading-6" style={{ color: C.text }}>Start with a clear promise</h4>
                  <p className="text-sm mt-1" style={{ color: C.muted }}>Help learners quickly understand who the plan is for and what it unlocks.</p>
                </div>
                <label className="block text-xs font-semibold" style={{ color: C.muted }}>
                  Plan name
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Career Accelerator" className={`${FIELD} mt-2`} style={inputStyle(C)} />
                </label>
                <label className="block text-xs font-semibold" style={{ color: C.muted }}>
                  Short description
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explain the outcome learners can expect from this plan"
                    className={`${FIELD} mt-2 min-h-28 resize-none`}
                    style={inputStyle(C)}
                    maxLength={240}
                  />
                  <span className="block text-right text-[11px] mt-2 font-normal" style={{ color: C.faint }}>{description.length}/240</span>
                </label>
                <div className="rounded-2xl p-4" style={{ background: C.page }}>
                  <p className="text-[11px] uppercase tracking-[0.16em] font-semibold" style={{ color: C.faint }}>Learner preview</p>
                  <p className="font-bold mt-2" style={{ color: C.text }}>{name.trim() || 'Your plan name'}</p>
                  <p className="text-xs mt-2" style={{ color: C.muted }}>{description.trim() || 'A concise description of the value learners receive.'}</p>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-base font-bold leading-6" style={{ color: C.text }}>Build the learning bundle</h4>
                  <p className="text-sm mt-1" style={{ color: C.muted }}>Select everything learners should unlock with this plan.</p>
                </div>
                <div className="max-h-[420px] overflow-y-auto pr-1">
                  <ContentPicker
                    options={contentOptions}
                    selected={contentKeys}
                    onChange={setContentKeys}
                    empty="No published content yet. Publish content first, or save this plan as a draft."
                    aside={<span className="text-xs font-semibold" style={{ color: C.muted }}>{contentKeys.length} selected</span>}
                    C={C}
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <PlanPriceFields prices={prices} setPrices={setPrices} discount={discount} C={C} />
                <PlanDiscountFields discount={discount} setDiscount={setDiscount} prices={prices} C={C} />
                <div className="rounded-2xl p-4 mt-5 flex items-start gap-3" style={{ background: C.page }}>
                  <ShieldCheck className="w-5 h-5 flex-shrink-0" style={{ color: C.muted }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: C.text }}>You control when it goes live</p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>Save a draft to finish later, or create and activate once content and at least one valid price are ready.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-7 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
              <button
                type="button"
                onClick={() => (step === 0 ? requestClose() : setStep((step - 1) as 0 | 1))}
                disabled={busy}
                className={BUTTON}
                style={{ background: C.pill, color: C.text }}
              >
                {step === 0 ? 'Cancel' : 'Back'}
              </button>
              {step < 2 ? (
                <button type="button" onClick={() => setStep((step + 1) as 1 | 2)} disabled={!hasName} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button type="button" onClick={() => createPlan('inactive')} disabled={busy || !hasName} className={BUTTON} style={{ background: C.pill, color: C.text }}>
                    Save draft
                  </button>
                  <button type="button" onClick={() => createPlan('active')} disabled={busy || readyCount < 3} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
                    <Sparkles className="w-4 h-4" />
                    {busy ? 'Creating...' : 'Create and activate'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-2xl p-4 self-start lg:sticky lg:top-0" style={{ background: C.page }}>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" style={{ color: C.muted }} />
              <p className="text-sm font-bold" style={{ color: C.text }}>Plan readiness</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                [checks[0], 'Plan details', name.trim() || 'Name still needed'],
                [checks[1], 'Included content', contentKeys.length ? `${contentKeys.length} items selected` : 'Add at least one item'],
                [checks[2], 'Purchase options', `${livePrices} active prices`],
              ].map(([ready, label, detail]) => (
                <div key={String(label)} className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0 mt-0.5" style={{ background: ready ? C.successBg : C.card, color: ready ? C.successText : C.faint }}>
                    {ready ? <Check className="w-3 h-3" /> : <span className="text-[11px]">!</span>}
                  </span>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: C.text }}>{label}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <div className="flex items-center justify-between text-[11px] font-semibold" style={{ color: C.muted }}>
                <span>Setup progress</span>
                <span>{readyCount}/3</span>
              </div>
              <div className="h-2 rounded-full mt-2 overflow-hidden" style={{ background: C.card }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(readyCount / 3) * 100}%`, background: P.sel }} />
              </div>
            </div>
          </aside>
        </div>
      </Modal>
      {confirmClose && (
        <UnsavedChangesDialog
          creating
          busy={busy}
          canSave={hasName}
          onDiscard={discard}
          onKeepEditing={() => setConfirmClose(false)}
          onSave={() => createPlan('inactive')}
          C={C}
        />
      )}
    </>
  );
}
