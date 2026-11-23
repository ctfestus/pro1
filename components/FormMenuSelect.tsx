'use client';

/**
 * The shared dropdown (MenuSelect) inside a sign-up form, for forms that read their answers from
 * the form on submit and rely on the browser's own "please fill in" check. An invisible input over
 * the dropdown carries the field's name, value and `required`, so FormData and the check work as
 * they did with a native select. Pass value and onChange to control it; leave them out and it
 * keeps its own value.
 */
import { useState } from 'react';
import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';

export function FormMenuSelect({ label, name, required, options, placeholder = 'Select an option', value, onChange, C }: {
  label: string;
  name?: string;
  required?: boolean;
  options: string[];
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  C: ThemeColors;
}) {
  const [own, setOwn] = useState('');
  const current = value ?? own;
  const choose = (next: string) => { setOwn(next); onChange?.(next); };
  return (
    <div className="relative">
      <MenuSelect label={label} field C={C} placeholder={placeholder} value={current} onChange={choose}
        options={options.map(option => ({ value: option, label: option }))} />
      <input tabIndex={-1} aria-hidden="true" name={name} required={required} value={current} onChange={() => {}}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0" />
    </div>
  );
}
