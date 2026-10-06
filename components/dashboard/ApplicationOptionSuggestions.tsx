'use client';

import { useState } from 'react';
import { Check, Lightbulb, LoaderCircle, Sparkles } from 'lucide-react';
import {
  applyApplicationOptionSuggestion,
  applicationSuggestionActions,
  isApplicationChoiceType,
} from '@/lib/application-option-suggestions';
import type { ApplicationQuestion } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

interface AiSuggestion {
  label: string;
  questionType: ApplicationQuestion['type'];
  options: string[];
}

export function ApplicationOptionSuggestions({ question, hasDependentConditions, token, C, onUpdate }: {
  question: ApplicationQuestion;
  hasDependentConditions: boolean;
  token: string;
  C: ThemeColors;
  onUpdate: (patch: Partial<ApplicationQuestion>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ label: string; message: string } | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const label = question.label.trim();
  const isChoice = isApplicationChoiceType(question.type);
  const { quick, canSuggestWithAi } = applicationSuggestionActions(question, hasDependentConditions);
  const aiOptions = aiSuggestion?.label === label && aiSuggestion.questionType === question.type ? aiSuggestion.options : null;
  const quickApplied = quick?.type === 'yes_no'
    ? question.type === 'yes_no'
    : Boolean(quick && isChoice && quick.options.every(option => (question.options ?? []).some(existing => existing.trim().toLowerCase() === option.toLowerCase())));

  if (!quick && !canSuggestWithAi) return null;

  function applyOptions(options: string[], suggestedType: 'single_choice' | 'yes_no') {
    const patch = applyApplicationOptionSuggestion(question, options, suggestedType, hasDependentConditions);
    if (patch) onUpdate(patch);
  }

  async function generateOptions() {
    if (loading || !canSuggestWithAi) return;
    setLoading(true);
    setError(null);
    setAiSuggestion(null);
    try {
      const response = await fetch('/api/application-forms/suggest-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label, helpText: question.helpText ?? '', questionType: isChoice ? question.type : 'single_choice' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not suggest options.');
      if (!Array.isArray(result.options) || result.options.length < 2 || result.options.some((option: unknown) => typeof option !== 'string')) throw new Error('No usable options were suggested.');
      setAiSuggestion({ label, questionType: question.type, options: result.options });
    } catch (reason) {
      setError({ label, message: (reason as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl p-3" style={{ background: C.input }}>
      {quick && <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.text }}><Lightbulb className="h-3.5 w-3.5" style={{ color: C.cta }} /> Suggested: {quick.title}</p>
          <p className="mt-1 text-[11px] leading-4" style={{ color: C.muted }}>{quick.options.join(', ')}</p>
        </div>
        <button type="button" disabled={quickApplied} onClick={() => applyOptions(quick.options, quick.type)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60" style={{ background: C.card, color: C.cta }}>
          {quickApplied ? <><Check className="h-3.5 w-3.5" /> Added</> : quick.type === 'yes_no' ? 'Use Yes or no' : 'Use options'}
        </button>
      </div>}
      {canSuggestWithAi && <div className={quick ? 'mt-3 border-t pt-3' : ''} style={quick ? { borderColor: C.inputBorder } : undefined}>
        <button type="button" disabled={loading} onClick={() => void generateOptions()} className="flex items-center gap-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ color: C.cta }}>
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? 'Suggesting options...' : isChoice ? 'Suggest more with AI' : 'Suggest choices with AI'}
        </button>
        {aiOptions && <div className="mt-3 flex flex-wrap items-center gap-2">
          {aiOptions.map(option => <span key={option} className="rounded-md px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text }}>{option}</span>)}
          <button type="button" onClick={() => { applyOptions(aiOptions, 'single_choice'); setAiSuggestion(null); }} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: C.cta, color: C.ctaText }}>{isChoice ? 'Add these options' : 'Use as multiple choice'}</button>
        </div>}
        {error?.label === label && <p role="alert" className="mt-2 text-[11px]" style={{ color: C.errorText }}>{error.message}</p>}
      </div>}
    </div>
  );
}
