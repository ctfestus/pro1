import { CalendarCheck2, ShieldCheck, Ticket } from 'lucide-react';
import { formatApplicationFeeAmount, type ApplicationFee } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationFeeTicket({ fee, C }: { fee: ApplicationFee; C: ThemeColors }) {
  return (
    <section className="mt-6" aria-label={`${fee.name} details`}>
      <div className="grid overflow-hidden rounded-xl sm:grid-cols-[minmax(0,1fr)_210px]" style={{ background: C.input }}>
        <div className="p-5 sm:p-6">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: C.cta }}><Ticket className="h-4 w-4" /> Programme fee</p>
          <h2 className="mt-4 text-lg font-semibold" style={{ color: C.text }}>{fee.name}</h2>
          {fee.description && <p className="mt-1.5 max-w-md text-xs leading-5" style={{ color: C.muted }}>{fee.description}</p>}
        </div>
        <div className="relative flex flex-col items-start justify-center border-t border-dashed p-5 sm:border-l sm:border-t-0 sm:p-6" style={{ background: C.pill, borderColor: C.inputBorder }}>
          <span aria-hidden="true" className="absolute -top-2 left-0 h-4 w-4 -translate-x-1/2 rounded-full sm:left-0 sm:top-0 sm:-translate-y-1/2" style={{ background: C.card }} />
          <span aria-hidden="true" className="absolute -top-2 right-0 h-4 w-4 translate-x-1/2 rounded-full sm:-bottom-2 sm:left-0 sm:right-auto sm:top-auto sm:translate-y-0 sm:-translate-x-1/2" style={{ background: C.card }} />
          <p className="text-[11px]" style={{ color: C.faint }}>One-time fee</p>
          <p className="mt-1 max-w-full text-2xl font-semibold tabular-nums" style={{ color: C.text }}><span className="mr-1.5 text-sm" style={{ color: C.cta }}>{fee.currency}</span><span className="break-all">{formatApplicationFeeAmount(fee.amount)}</span></p>
          <span className="mt-3 inline-flex max-w-full items-start gap-1.5 break-words rounded-md px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: C.card, color: C.cta }}><CalendarCheck2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {fee.due}</span>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-2 text-[11px] leading-5" style={{ color: C.muted }}><ShieldCheck className="h-4 w-4 shrink-0" style={{ color: C.cta }} /> No payment is collected through this application form.</p>
    </section>
  );
}
