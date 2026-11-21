'use client';

// Account settings, Experience step: work experience, education and skills.

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { modalStyle, type ThemeColors } from '@/lib/theme';
import { sanitizePlainText } from '@/lib/sanitize';
import { useToolIcons } from '@/lib/use-tool-icons';
import { MenuSelect } from '@/components/MenuSelect';
import { FIELD, Hint, Label, Sect, inputStyle } from '@/components/create/EditorKit';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { Card, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { EntryCard, TOOLS, panelField, type EducationEntry, type WorkEntry } from './shared';

const YEARS = Array.from({ length: new Date().getFullYear() - 1969 }, (_, i) => String(new Date().getFullYear() - i));
const DEGREES = ['High School', 'Diploma', 'Associate', "Bachelor's", "Master's", 'MBA', 'PhD', 'Certificate', 'Other'];

function Field({ label, children, C }: { label: string; children: ReactNode; C: ThemeColors }) {
  return <div className="min-w-0"><Label C={C}>{label}</Label>{children}</div>;
}

/** A dropdown inside a grey entry panel, so it takes the card colour. */
function PanelSelect({ label, value, onChange, options, placeholder, C }: { label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder: string; C: ThemeColors }) {
  return (
    <MenuSelect field searchable={options.length > 12} label={label} placeholder={placeholder} value={value} onChange={onChange}
      options={options.map(o => ({ value: o, label: o }))} C={{ ...C, input: C.card }} />
  );
}

function Years<T extends { start_year: string; end_year: string; current: boolean }>({ entry, update, currentLabel, C }: {
  entry: T; update: (patch: Partial<T>) => void; currentLabel: string; C: ThemeColors;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start year" C={C}>
          <PanelSelect label="Start year" value={entry.start_year} onChange={v => update({ start_year: v } as Partial<T>)} options={YEARS} placeholder="Year" C={C} />
        </Field>
        <Field label="End year" C={C}>
          {entry.current
            ? <div className="flex items-center rounded-[10px] px-3 py-3 text-sm" style={{ ...panelField(C), color: C.faint }}>Present</div>
            : <PanelSelect label="End year" value={entry.end_year} onChange={v => update({ end_year: v } as Partial<T>)} options={YEARS} placeholder="Year" C={C} />}
        </Field>
      </div>
      <button type="button" role="checkbox" aria-checked={entry.current} onClick={() => update({ current: !entry.current, end_year: !entry.current ? '' : entry.end_year } as Partial<T>)}
        className="flex items-center gap-2 w-fit text-sm" style={{ color: C.text }}>
        <Tick on={entry.current} C={C} /> {currentLabel}
      </button>
    </>
  );
}

export function ExperienceStep({ C, education, setEducation, workExperience, setWorkExperience, skills, setSkills }: {
  C: ThemeColors;
  education: EducationEntry[]; setEducation: Dispatch<SetStateAction<EducationEntry[]>>;
  workExperience: WorkEntry[]; setWorkExperience: Dispatch<SetStateAction<WorkEntry[]>>;
  skills: string[]; setSkills: Dispatch<SetStateAction<string[]>>;
}) {
  const P = palette(C);
  const toolIcon = useToolIcons();
  const [skillInput, setSkillInput] = useState('');
  const updateJob = (i: number, patch: Partial<WorkEntry>) => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x));
  const updateEd = (i: number, patch: Partial<EducationEntry>) => setEducation(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x));

  const query = skillInput.trim().toLowerCase();
  const suggestions = TOOLS.filter(s => s.toLowerCase().includes(query) && !skills.includes(s)).slice(0, 8);
  const canAddCustom = query.length > 1 && !skills.map(s => s.toLowerCase()).includes(query) && !TOOLS.map(s => s.toLowerCase()).includes(query);
  const addSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed || skills.includes(trimmed) || skills.length >= 20) return;
    setSkills(prev => [...prev, trimmed]);
    setSkillInput('');
  };
  const icon = (s: string, size: number) => toolIcon(s) && <img src={toolIcon(s)} alt="" style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />;

  const addBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick} className={btnSmClass} style={btnStyle('sec', C)}><Plus className="w-3.5 h-3.5" /> Add</button>
  );

  return (
    <Card C={C}>
      <Sect title="Work experience" first C={C}
        action={addBtn(() => setWorkExperience(prev => [...prev, { id: crypto.randomUUID(), company: '', title: '', start_year: '', end_year: '', current: false }]))}>
        {workExperience.length === 0 && <p className="text-sm" style={{ color: C.muted }}>No work experience added yet.</p>}
        {workExperience.map((job, i) => {
          const words = (job.description ?? '').trim().split(/\s+/).filter(Boolean).length;
          const over = words > 120;
          return (
            <EntryCard key={job.id} label="Remove this job" onDelete={() => setWorkExperience(prev => prev.filter((_, j) => j !== i))} C={C}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company" C={C}>
                  <input value={job.company} onChange={e => updateJob(i, { company: sanitizePlainText(e.target.value) })} placeholder="For example Google" className={FIELD} style={panelField(C)} />
                </Field>
                <Field label="Job title" C={C}>
                  <input value={job.title} onChange={e => updateJob(i, { title: sanitizePlainText(e.target.value) })} placeholder="For example Software Engineer" className={FIELD} style={panelField(C)} />
                </Field>
              </div>
              <Years entry={job} update={patch => updateJob(i, patch)} currentLabel="I currently work here" C={C} />
              <Field label="Description" C={C}>
                <textarea value={job.description ?? ''} onChange={e => updateJob(i, { description: sanitizePlainText(e.target.value) })} rows={3}
                  placeholder="Briefly describe your role and responsibilities" className={`${FIELD} resize-none`}
                  style={{ ...panelField(C), ...(over ? { border: `1px solid ${P.bad}` } : {}) }} />
                <p className="text-right text-xs mt-1" style={{ color: over ? P.bad : C.faint }}>{words}/120 words</p>
              </Field>
            </EntryCard>
          );
        })}
      </Sect>

      <Sect title="Education" C={C}
        action={addBtn(() => setEducation(prev => [...prev, { id: crypto.randomUUID(), school: '', degree: '', field: '', start_year: '', end_year: '', current: false }]))}>
        {education.length === 0 && <p className="text-sm" style={{ color: C.muted }}>No education added yet.</p>}
        {education.map((ed, i) => (
          <EntryCard key={ed.id} label="Remove this school" onDelete={() => setEducation(prev => prev.filter((_, j) => j !== i))} C={C}>
            <Field label="School or university" C={C}>
              <input value={ed.school} onChange={e => updateEd(i, { school: sanitizePlainText(e.target.value) })} placeholder="For example University of Ghana" className={FIELD} style={panelField(C)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Degree" C={C}>
                <PanelSelect label="Degree" value={ed.degree} onChange={v => updateEd(i, { degree: v })} options={DEGREES} placeholder="Select degree" C={C} />
              </Field>
              <Field label="Field of study" C={C}>
                <input value={ed.field} onChange={e => updateEd(i, { field: sanitizePlainText(e.target.value) })} placeholder="For example Computer Science" className={FIELD} style={panelField(C)} />
              </Field>
            </div>
            <Years entry={ed} update={patch => updateEd(i, patch)} currentLabel="Currently studying here" C={C} />
          </EntryCard>
        ))}
      </Sect>

      <Sect title="Skills" C={C}>
        <Hint C={C}>We recommend adding your top 5 skills used in your role.</Hint>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {skills.map(skill => (
              <span key={skill} className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full text-xs font-semibold" style={{ background: C.pill, color: C.text }}>
                {icon(skill, 13)}
                {skill}
                <button type="button" aria-label={`Remove ${skill}`} onClick={() => setSkills(prev => prev.filter(s => s !== skill))} className="grid place-items-center hover:opacity-60">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <input value={skillInput} onChange={e => setSkillInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) addSkill(suggestions[0]); else if (canAddCustom) addSkill(skillInput); } }}
            placeholder="Search or type a skill" className={FIELD} style={inputStyle(C)} />
          {skillInput && (suggestions.length > 0 || canAddCustom) && (
            <div className="absolute z-20 left-0 right-0 mt-2 rounded-2xl p-1.5 grid" style={modalStyle(C)}>
              {suggestions.map(s => (
                <button key={s} type="button" onMouseDown={e => { e.preventDefault(); addSkill(s); }} className="w-full text-left rounded-xl px-3 py-2.5 text-sm hover:opacity-70" style={{ color: C.text }}>
                  {s}
                </button>
              ))}
              {canAddCustom && (
                <button type="button" onMouseDown={e => { e.preventDefault(); addSkill(skillInput.trim()); }} className="w-full text-left rounded-xl px-3 py-2.5 text-sm hover:opacity-70" style={{ color: C.muted }}>
                  Add &quot;{skillInput.trim()}&quot;
                </button>
              )}
            </div>
          )}
        </div>
        {!skillInput && (
          <div>
            <Label C={C}>Suggested</Label>
            <div className="flex flex-wrap gap-2">
              {TOOLS.filter(s => !skills.includes(s)).slice(0, 12).map(s => (
                <button key={s} type="button" onClick={() => addSkill(s)} className={btnSmClass} style={btnStyle('sec', C)}>
                  <Plus className="w-3.5 h-3.5" />{icon(s, 14)}{s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Sect>
    </Card>
  );
}
