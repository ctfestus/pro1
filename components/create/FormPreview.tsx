'use client';

// FormPreview (live preview pane) + its preview-only helpers/constants, extracted verbatim
// from app/create/page.tsx. buttonThemes / formatDateParts / formatLocation are preview-only
// and live here; SOCIAL_PLATFORMS / isRequired / SocialIcon are shared (./shared).

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import { AnimatedField, type ThemeColor } from '@/components/AnimatedField';
import { getFontById, loadGoogleFont } from '@/lib/fonts';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { sanitizeRichText } from '@/lib/sanitize';
import type { FormConfig, FormField } from '@/lib/course-schema';
import { SocialIcon, SOCIAL_PLATFORMS, isRequired } from '@/components/create/shared';
import { ArrowRight, ArrowUpRight, Building2, CheckCircle2, Loader2, MapPin } from 'lucide-react';

// CourseTaker is only shown in preview mode -- load it lazily to keep initial bundle small
const CourseTaker = dynamic(() => import('@/components/CourseTaker').then(m => ({ default: m.CourseTaker })), { ssr: false });

const buttonThemes: Record<ThemeColor, string> = {
  forest:  'bg-[#00bf63] hover:bg-[#00994f] text-white',
  lime:    'bg-[#ADEE66] hover:bg-[#9ad94d] text-black',
  emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  rose:    'bg-rose-500 hover:bg-rose-600 text-white',
  amber:   'bg-amber-500 hover:bg-amber-600 text-white',
  ocean:   'bg-[#3E93FF] hover:bg-[#2f7fe0] text-white',
};

const formatDateParts = (dateString?: string) => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return {
      monthShort: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.toLocaleDateString('en-US', { day: 'numeric' }),
      fullDate: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    };
  } catch { return null; }
};

const formatLocation = (locationString?: string) => {
  if (!locationString) return { main: '', sub: '' };
  const parts = locationString.split(',');
  return parts.length > 1
    ? { main: parts[0].trim(), sub: parts.slice(1).join(',').trim() }
    : { main: locationString, sub: '' };
};

// --- FormPreview ---
export function FormPreview({ config, isSubmitting, onSubmit, isSuccess, onReset, isSharedView }: {
  config: FormConfig;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>, data?: any) => void;
  isSuccess: boolean;
  onReset: () => void;
  isSharedView: boolean;
}) {
  const [isRegistering, setIsRegistering] = useState(false);
  const fontOption = getFontById(config.font ?? 'google-sans-text');
  useEffect(() => { loadGoogleFont(fontOption); }, [fontOption]);
  const fontStyle = { fontFamily: fontOption.cssFamily };
  const containerBg = config.mode === 'light' ? 'bg-white border-zinc-200 shadow-2xl shadow-black/10' : 'bg-zinc-900/60 border-zinc-800/60 backdrop-blur-sm';
  const textColor = config.mode === 'light' ? 'text-zinc-900' : 'text-white';
  const mutedTextColor = config.mode === 'light' ? 'text-zinc-500' : 'text-zinc-400';
  const labelColor = config.mode === 'light' ? 'text-zinc-700' : 'text-zinc-300';
  const inputBg = config.mode === 'light' ? 'bg-transparent text-zinc-900 placeholder:text-zinc-400' : 'bg-transparent text-white placeholder:text-zinc-600';
  const selectOptionBg = config.mode === 'light' ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white';
  const dividerCls = config.mode === 'light' ? 'bg-zinc-200' : 'bg-zinc-700';

  if (config.isCourse) {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        {/* Course cover / header */}
        {(config.coverImage || config.title || config.description) && (
          <div className={`border rounded-2xl overflow-hidden ${containerBg}`} style={fontStyle}>
            {config.coverImage && (
              <img src={resolveCoverUrl(config.coverImage)} alt="Cover" className="w-full h-44 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
            )}
            <div className="p-7">
              <h2 className={`text-xl font-semibold tracking-tight ${textColor}`}>{config.title}</h2>
              {config.description && (
                <div className={`mt-2 text-sm leading-relaxed ${mutedTextColor} rich-preview`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.description) }} />
              )}
            </div>
          </div>
        )}
        <CourseTaker config={config} isSubmitting={isSubmitting} onSubmit={onSubmit} isSuccess={isSuccess} />
      </div>
    );
  }

  if (isSuccess) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`max-w-xl mx-auto text-center py-16 border rounded-3xl p-8 space-y-6 ${containerBg}`} style={fontStyle}>
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h2 className={`text-3xl font-medium ${textColor}`}>Successfully Submitted!</h2>
        <p className={mutedTextColor}>Your response has been recorded.</p>
        {!isSharedView && <button onClick={onReset} className="text-brand-accent hover:text-brand-accent text-sm transition-colors">Back to Editor</button>}
        {isSharedView && <button onClick={() => window.location.href = '/create'} className="text-brand-accent hover:text-brand-accent text-sm transition-colors">Create your own AI form</button>}
      </motion.div>
    );
  }

  const renderField = (field: FormField) => {
    const req = isRequired(field);
    switch (field.type) {
      case 'phone':
        return (
          <input
            type="tel"
            required={req}
            placeholder={field.placeholder || '+233 24 000 0000'}
            className={`w-full border-none outline-none px-4 py-3 text-sm ${inputBg}`}
          />
        );

      case 'company':
        return (
          <div className="flex items-center w-full">
            <span className={`px-3 py-3 flex-shrink-0 ${config.mode === 'light' ? 'text-zinc-400' : 'text-zinc-600'}`}>
              <Building2 className="w-4 h-4" />
            </span>
            <span className={`w-px self-stretch my-2 ${dividerCls}`} />
            <input type="text" required={req} placeholder={field.placeholder || 'Company name...'} className={`flex-1 border-none outline-none px-4 py-3 text-sm ${inputBg}`} />
          </div>
        );

      case 'social': {
        const platforms = SOCIAL_PLATFORMS.filter(p =>
          !field.socialPlatforms?.length || field.socialPlatforms.includes(p.id)
        );
        return (
          <div className="space-y-3">
            {platforms.map((platform, pIdx) => (
              <AnimatedField key={platform.id} theme={config.theme} mode={config.mode}>
                <div className="flex items-center">
                  <span className={`px-3 py-3 flex-shrink-0`}>
                    <SocialIcon id={platform.id} size={18} />
                  </span>
                  <span className={`w-px self-stretch my-2 ${dividerCls}`} />
                  <input
                    type="url"
                    required={pIdx === 0 && req}
                    placeholder={platform.placeholder}
                    className={`flex-1 border-none outline-none px-4 py-3 text-sm ${inputBg}`}
                  />
                </div>
              </AnimatedField>
            ))}
          </div>
        );
      }

      case 'textarea':
        return <textarea required={req} placeholder={field.placeholder} className={`w-full border-none outline-none px-4 py-3 min-h-[110px] resize-y text-sm ${inputBg}`} />;

      case 'select':
        return (
          <select required={req} defaultValue="" className={`w-full border-none outline-none px-4 py-3 appearance-none cursor-pointer text-sm ${inputBg}`}>
            <option value="" disabled className={selectOptionBg}>{field.placeholder || 'Select an option...'}</option>
            {field.options?.map(opt => <option key={opt} value={opt} className={selectOptionBg}>{opt}</option>)}
          </select>
        );

      default:
        return (
          <input
            type={field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : 'text'}
            required={req}
            placeholder={field.placeholder}
            className={`w-full border-none outline-none px-4 py-3 text-sm ${inputBg}`}
          />
        );
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className={`max-w-xl mx-auto border rounded-3xl overflow-hidden ${containerBg}`} style={fontStyle}>
      {config.coverImage && <img src={resolveCoverUrl(config.coverImage)} alt="Cover" className="w-full h-52 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />}
      <div className="p-8 md:p-10">
        <div className="mb-8">
          <h2 className={`text-2xl font-semibold mb-2 tracking-tight ${textColor}`}>{config.title}</h2>
          <div className={`text-sm leading-relaxed ${mutedTextColor} rich-preview`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.description) }} />

          {config.eventDetails?.isEvent && (
            <div className={`mt-8 p-6 rounded-2xl border space-y-5 ${config.mode === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-zinc-800/40 border-zinc-700/50'}`}>
              {(config.eventDetails.date || config.eventDetails.time) && (
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-11 h-11 rounded-xl border flex flex-col overflow-hidden ${config.mode === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-800 border-zinc-700'}`}>
                    <div className={`h-4 flex items-center justify-center text-[9px] font-bold tracking-wider ${config.mode === 'light' ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-700 text-zinc-300'}`}>
                      {formatDateParts(config.eventDetails.date)?.monthShort || 'DAT'}
                    </div>
                    <div className={`flex-1 flex items-center justify-center text-base font-bold ${textColor}`}>
                      {formatDateParts(config.eventDetails.date)?.day || '--'}
                    </div>
                  </div>
                  <div>
                    <div className={`text-sm font-semibold ${textColor}`}>{formatDateParts(config.eventDetails.date)?.fullDate || config.eventDetails.date || 'Date TBD'}</div>
                    {(config.eventDetails.time || config.eventDetails.timezone) && (
                      <div className={`text-xs mt-0.5 ${mutedTextColor}`}>{config.eventDetails.time} {config.eventDetails.timezone}</div>
                    )}
                  </div>
                </div>
              )}
              {config.eventDetails.location && (
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-11 h-11 rounded-xl border flex items-center justify-center ${config.mode === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-800 border-zinc-700'}`}>
                    <MapPin className={`w-4 h-4 ${mutedTextColor}`} />
                  </div>
                  <div>
                    <div className={`text-sm font-semibold flex items-center gap-1 ${textColor}`}>
                      {formatLocation(config.eventDetails.location).main}
                      <ArrowUpRight className={`w-3 h-3 ${mutedTextColor}`} />
                    </div>
                    {formatLocation(config.eventDetails.location).sub && (
                      <div className={`text-xs mt-0.5 ${mutedTextColor}`}>{formatLocation(config.eventDetails.location).sub}</div>
                    )}
                  </div>
                </div>
              )}
              {!isRegistering && (
                <button type="button" onClick={() => setIsRegistering(true)} className={`w-full py-3 rounded-xl font-medium transition-all active:scale-[0.98] text-sm ${buttonThemes[config.theme]}`}>
                  Register Now
                </button>
              )}
            </div>
          )}
        </div>

        {(!config.eventDetails?.isEvent || isRegistering) && (
          <form onSubmit={onSubmit} className="space-y-5">
            {config.fields.map((field, idx) => (
              <motion.div key={field.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }} className="space-y-1.5">
                {field.type === 'description' ? (
                  <div className={`py-1 ${config.mode === 'light' ? 'border-zinc-200' : 'border-zinc-800'}`}>
                    {field.label && field.label !== 'Section' && (
                      <p className={`text-sm font-semibold mb-1 ${textColor}`}>{field.label}</p>
                    )}
                    {field.description && (
                      <div className={`text-sm leading-relaxed ${mutedTextColor} rich-preview`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(field.description) }} />
                    )}
                  </div>
                ) : (
                  <>
                    <div className="ml-0.5 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <label className={`text-xs font-medium ${labelColor}`}>{field.label}</label>
                        {!isRequired(field) && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.mode === 'light' ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-800 text-zinc-600'}`}>optional</span>
                        )}
                      </div>
                      {field.description && (
                        <div className={`text-[11px] leading-relaxed ${mutedTextColor} rich-preview`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(field.description) }} />
                      )}
                    </div>
                    {field.type === 'social' ? renderField(field) : (
                      <AnimatedField theme={config.theme} mode={config.mode}>
                        {renderField(field)}
                      </AnimatedField>
                    )}
                  </>
                )}
              </motion.div>
            ))}
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} type="submit" disabled={isSubmitting} className={`w-full py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 mt-6 disabled:opacity-60 text-sm ${buttonThemes[config.theme]}`}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><span>Submit</span><ArrowRight className="w-4 h-4" /></>}
            </motion.button>
          </form>
        )}
      </div>
    </motion.div>
  );
}
