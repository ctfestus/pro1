import { CalendarCheck2, ShieldCheck, Ticket } from 'lucide-react';
import { formatApplicationFeeAmount, type ApplicationFee } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationFeeTicket({ fee, C }: { fee: ApplicationFee; C: ThemeColors }) {
  const amount = formatApplicationFeeAmount(fee.amount);
  const amountSize = amount === 'Set amount' ? 'text-3xl sm:text-4xl' : amount.length > 12 ? 'text-[2.5rem] sm:text-[3rem]' : amount.length > 7 ? 'text-5xl sm:text-6xl' : 'text-6xl sm:text-[5.5rem]';

  return (
    <section className="mt-6" aria-label={`${fee.name} details`}>
      <div className="rounded-[24px] p-2 sm:p-2.5" style={{ background: C.pill }}>
        <div className="relative isolate overflow-hidden rounded-[18px] px-5 pb-5 pt-6 sm:px-7 sm:pb-6 sm:pt-7" style={{ background: 'linear-gradient(145deg, #151C29 0%, #090D15 75%)', color: '#FFFFFF' }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 75% -30%, color-mix(in srgb, ${C.cta} 55%, transparent), transparent 58%)`, opacity: 0.55 }} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)', backgroundSize: '42px 42px' }} />
          <div className="relative grid min-w-0 gap-7 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)] sm:items-center sm:gap-8">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: `color-mix(in srgb, ${C.cta} 60%, white)` }}><Ticket className="h-4 w-4" /> Programme fee</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/65">{fee.currency} / One-time</p>
              <p className={`mt-1 min-w-0 break-all font-black leading-none tracking-[-0.075em] tabular-nums ${amountSize}`}>{amount}</p>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-3 pb-2 pl-1 pr-2 sm:pl-3">
              <div className="max-w-full self-end -rotate-1 bg-white px-3 py-2 text-[#111827]" style={{ boxShadow: `5px 5px 0 color-mix(in srgb, ${C.cta} 70%, #111827)` }}>
                <p className="flex items-start gap-2 text-[11px] font-bold uppercase leading-4 tracking-wide"><CalendarCheck2 className="h-4 w-4 shrink-0" /> <span className="break-words">Due: {fee.due}</span></p>
              </div>
              <div className="max-w-full -rotate-1 bg-white px-4 py-2.5 text-[#0E1420]" style={{ boxShadow: `-8px 8px 0 ${C.cta}` }}>
                <h2 className="break-words text-xl font-black uppercase leading-tight tracking-tight sm:text-2xl">{fee.name}</h2>
              </div>
              {fee.description && <div className="max-w-full rotate-1 bg-white px-4 py-2 text-[#17202D]" style={{ boxShadow: `7px 7px 0 color-mix(in srgb, ${C.cta} 65%, #111827)` }}><p className="break-words text-xs font-medium leading-5">{fee.description}</p></div>}
            </div>
          </div>
          <p className="relative mt-6 flex items-start gap-2 border-t border-white/15 pt-4 text-[11px] leading-5 text-white/70"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> No payment is collected through this application form.</p>
        </div>
      </div>
    </section>
  );
}
