'use client';

// The Publish step of the virtual experience editor: who can take it, subscription plans and
// the deadline.

import React from 'react';
import { PlanAccessPicker } from '@/components/PlanAccessPicker';
import { palette } from '@/components/dashboard/subscriptions/ui';
import { SwitchRow, TickList } from '@/components/create/EditorKit';
import { type ThemeColors } from '@/lib/theme';

export function PublishStep({ C, card, inp, availableToEveryone, setAvailableToEveryone, cohorts, selectedCohorts, setSelectedCohorts, experienceId, deadlineDays, setDeadlineDays }: {
  C: ThemeColors;
  card: React.CSSProperties;
  inp: React.CSSProperties;
  availableToEveryone: boolean;
  setAvailableToEveryone: (on: boolean) => void;
  cohorts: { id: string; name: string }[];
  selectedCohorts: string[];
  setSelectedCohorts: React.Dispatch<React.SetStateAction<string[]>>;
  experienceId: string | null;
  deadlineDays: string;
  setDeadlineDays: (days: string) => void;
}) {
  const P = palette(C);
  return (
    <div className="space-y-4">

                    {/* Target Audience card */}
                    <div style={card} className="p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold" style={{ color: C.text }}>Who can take it</h3><span className="text-xs" style={{ color: C.muted }}>{availableToEveryone ? 'Everyone' : `${selectedCohorts.length} cohort${selectedCohorts.length === 1 ? '' : 's'}`}</span></div>
                      <SwitchRow C={C} title="Available to everyone" on={availableToEveryone} onChange={setAvailableToEveryone}
                        sub="Anyone with an account can open it, including learners not in a cohort. Cohort choices are set aside while this is on." />
                      {cohorts.length === 0
                        ? <p className="text-sm" style={{ color: C.muted }}>No bootcamp cohorts yet.</p>
                        : <div style={availableToEveryone ? { opacity: 0.45, pointerEvents: 'none' } : undefined} aria-hidden={availableToEveryone}>
                            <TickList C={C} items={cohorts} selected={selectedCohorts}
                              onToggle={id => setSelectedCohorts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
                          </div>}
                    </div>

                    {/* Subscription plans card */}
                    <div style={card} className="p-5">
                      <PlanAccessPicker
                        contentTable="virtual_experiences"
                        contentId={experienceId}
                        availableToEveryone={availableToEveryone}
                        onPublicAccessClosed={() => setAvailableToEveryone(false)}
                      />
                    </div>

                    {/* Deadline card */}
                    <div style={card} className="p-5 space-y-3">
    <h3 className="text-base font-semibold" style={{ color: C.text }}>Deadline</h3>
                      <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl self-start" style={{ background: C.page }}>
                        {['', '7', '14', '30'].map(days => {
                          const selected = deadlineDays === days;
                          return (
                            <button key={days || 'none'} type="button" aria-pressed={selected} onClick={() => setDeadlineDays(days)}
                              className="h-[34px] px-3.5 rounded-[9px] text-[13px] font-semibold"
                              style={selected ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                              {days ? `${days} days` : 'No deadline'}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          style={{ ...inp, width: 80, textAlign: 'center' }}
                          type="number"
                          min={1}
                          max={365}
                          placeholder=""
                          value={deadlineDays}
                          onChange={e => setDeadlineDays(e.target.value.replace(/\D/g, ''))}
                        />
                        <span className="text-sm" style={{ color: C.muted }}>days from assignment</span>
                      </div>
                      <p className="text-[11px]" style={{ color: C.faint }}>Students have this many days from when their cohort is assigned to complete the experience. Leave blank for no deadline.</p>
                    </div>

                    </div>
  );
}
