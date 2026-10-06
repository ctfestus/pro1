import type { ApplicationQuestion, ApplicationQuestionType } from '@/lib/application-forms';

export interface ApplicationOptionSuggestion {
  title: string;
  type: 'single_choice' | 'yes_no';
  options: string[];
}

const PRESETS: Array<{ title: string; match: RegExp; options: string[] }> = [
  { title: 'Gender', match: /\bgender\b/i, options: ['Male', 'Female', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'] },
  { title: 'Employment status', match: /\b(?:employment|work) status\b|\bcurrent occupation\b/i, options: ['Employed full-time', 'Employed part-time', 'Self-employed', 'Student', 'Not currently employed', 'Prefer not to say'] },
  { title: 'Education level', match: /\b(?:education|qualification) level\b|\blevel of (?:education|qualification)\b|\bhighest (?:level of )?(?:education|qualification|degree)\b|\bacademic level\b/i, options: ['Secondary school', 'Certificate', 'Diploma', "Bachelor's degree", "Master's degree", 'Doctorate', 'Other'] },
  { title: 'Years of experience', match: /\byears? of experience\b|\bhow (?:many years|long).*(?:experience|worked)\b/i, options: ['No experience', 'Less than 1 year', '1-2 years', '3-5 years', '6 or more years'] },
  { title: 'Experience level', match: /\b(?:experience|skill|proficiency) level\b/i, options: ['Beginner', 'Intermediate', 'Advanced'] },
  { title: 'Availability', match: /\bavailability\b|\b(?:days?|times?).*\bavailable\b/i, options: ['Weekdays', 'Evenings', 'Weekends', 'Flexible'] },
  { title: 'Learning format', match: /\b(?:learning|study|attendance|delivery) (?:format|mode)\b|\b(?:format|mode) of (?:learning|study|attendance)\b|\bonline or in.person\b/i, options: ['Online', 'In person', 'Hybrid'] },
  { title: 'Contact preference', match: /\b(?:preferred|best) (?:contact|communication) (?:method|channel)\b|\bhow (?:should|can) we (?:contact|reach) you\b/i, options: ['Email', 'Phone call', 'WhatsApp', 'SMS'] },
  { title: 'Referral source', match: /\bhow did you (?:hear|learn|find) (?:about )?(?:us|this|the programme|the program)\b|\breferral source\b/i, options: ['Social media', 'Friend or colleague', 'Search engine', 'School or university', 'Other'] },
  { title: 'Weekly time commitment', match: /\b(?:hours|time) per week\b|\bweekly (?:time )?commitment\b/i, options: ['Less than 5 hours', '5-10 hours', '11-20 hours', 'More than 20 hours'] },
  { title: 'Age range', match: /\bage (?:range|group|bracket)\b/i, options: ['Under 18', '18-24', '25-34', '35-44', '45-54', '55 or older', 'Prefer not to say'] },
  { title: 'Internet access', match: /\binternet (?:access|connection)\b/i, options: ['Reliable access', 'Occasional access', 'Limited access', 'No access'] },
  { title: 'Device access', match: /\b(?:device|computer) (?:access|availability)\b|\bwhat device (?:will|do) you use\b/i, options: ['Laptop or desktop', 'Smartphone', 'Tablet', 'Shared device'] },
];

const YES_NO_QUESTION = /\b(?:yes\s*(?:or|\/)\s*no)\b|^(?:are|have|do|did|will|would|can) you\s+(?:(?:currently|already|ever)\s+)?(?:have|need|want|agree|consent|own|hold|meet|plan|intend|commit|qualify|reside|live|work|study|participate|attend|available|eligible|willing|interested|able|ready|enrolled|employed)\b/i;

export function suggestApplicationOptions(label: string): ApplicationOptionSuggestion | null {
  const question = label.trim();
  if (!question || question.toLowerCase() === 'untitled question') return null;
  const preset = PRESETS.find(item => item.match.test(question));
  if (preset) return { title: preset.title, type: 'single_choice', options: [...preset.options] };
  if (YES_NO_QUESTION.test(question)) return { title: 'Yes or no', type: 'yes_no', options: ['Yes', 'No'] };
  return null;
}

export function normalizeApplicationAiOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const option = item.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
    const key = option.toLocaleLowerCase();
    if (!option || option.length > 80 || seen.has(key)) continue;
    seen.add(key);
    options.push(option);
    if (options.length === 8) break;
  }
  return options.length >= 2 ? options : [];
}

export function mergeApplicationOptions(current: string[] | undefined, suggested: string[]): string[] {
  const existing = current ?? [];
  const result = hasUntouchedApplicationOptions(existing) ? [] : [...existing];
  const seen = new Set(result.map(option => option.trim().toLocaleLowerCase()));
  for (const option of suggested) {
    const key = option.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    result.push(option);
    seen.add(key);
  }
  return result;
}

export function isApplicationChoiceType(type: ApplicationQuestionType): boolean {
  return type === 'single_choice' || type === 'multiple_choice' || type === 'dropdown';
}

function hasUntouchedApplicationOptions(options: string[] | undefined): boolean {
  return !options?.length || (options.length === 2 && options[0] === 'Option 1' && options[1] === 'Option 2');
}

export function canApplyApplicationOptionSuggestion(question: ApplicationQuestion, suggestedType: 'single_choice' | 'yes_no', hasDependentConditions = false): boolean {
  const text = question.type === 'short_text' || question.type === 'long_text';
  const choice = isApplicationChoiceType(question.type);
  if (!text && !choice) return false;
  if (suggestedType === 'yes_no' && choice && !hasUntouchedApplicationOptions(question.options)) return false;
  const nextType = suggestedType === 'yes_no' ? 'yes_no' : choice ? question.type : 'single_choice';
  return nextType === question.type || !hasDependentConditions;
}

export function applicationSuggestionActions(question: ApplicationQuestion, hasDependentConditions = false): { quick: ApplicationOptionSuggestion | null; canSuggestWithAi: boolean } {
  const suggested = suggestApplicationOptions(question.label);
  const quick = suggested && canApplyApplicationOptionSuggestion(question, suggested.type, hasDependentConditions) ? suggested : null;
  const label = question.label.trim();
  const ready = label.length >= 5 && label.toLowerCase() !== 'untitled question';
  const text = question.type === 'short_text' || question.type === 'long_text';
  return { quick, canSuggestWithAi: ready && (isApplicationChoiceType(question.type) || (text && !hasDependentConditions)) };
}

export function applyApplicationOptionSuggestion(question: ApplicationQuestion, options: string[], suggestedType: 'single_choice' | 'yes_no', hasDependentConditions = false): Partial<ApplicationQuestion> | null {
  if (!canApplyApplicationOptionSuggestion(question, suggestedType, hasDependentConditions)) return null;
  const type = suggestedType === 'yes_no' ? 'yes_no' : isApplicationChoiceType(question.type) ? question.type : 'single_choice';
  return {
    type,
    options: type === 'yes_no' ? undefined : mergeApplicationOptions(question.options, options),
    validation: type === question.type ? question.validation : undefined,
  };
}
