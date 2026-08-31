/**
 * Questions this pricing model actually raises.
 *
 * Every answer describes what the platform does, not what a pricing page usually says. The one
 * that matters most is renewal: access is a fixed period that ends, and burying that until the
 * day it stops is how a paying learner ends up feeling cut off.
 *
 * Native details/summary, so it opens without JavaScript, is reachable by keyboard, and the
 * answers stay in the page for search engines to read.
 */
import { ChevronDown, MessageCircleQuestion } from 'lucide-react';

export interface PricingFaqProps {
  headingFont?: string;
  primaryColor: string;
  supportEmail?: string;
  /** Named so an answer can refer to the paid tier by the name an admin gave it. */
  paidPlanName?: string;
}

export function PricingFaq({ headingFont, primaryColor, supportEmail, paidPlanName }: PricingFaqProps) {
  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const paid = paidPlanName || 'a paid plan';

  const faqs: { q: string; a: string }[] = [
    {
      q: 'Do I need to pay to start?',
      a: 'No. Creating an account is free and gives you the free courses straight away, with no card and no trial period counting down.',
    },
    {
      q: 'Does my access renew automatically?',
      a: 'No. You buy a fixed length of access and it ends on the date shown. Nothing charges you again, so there is no subscription to remember to cancel. We email you before it runs out, and you renew when you choose to.',
    },
    {
      q: 'What happens when my access ends?',
      a: `Your account stays, along with any certificates you have earned. The content included in ${paid} closes until you renew, and when you do you pick up where you left off.`,
    },
    {
      q: 'Can I pay for a longer period and save?',
      a: 'Yes. Longer lengths cost less per month, and the saving against the shortest option is shown on each one so you can see exactly what the difference is.',
    },
    {
      q: 'How can I pay?',
      a: 'Card, bank transfer or mobile money. Paying by card confirms your access immediately. For a bank transfer or mobile money you send us the transaction details and we open your access once we have checked it.',
    },
    {
      q: 'Can I switch to a different plan?',
      a: 'You hold one plan at a time. Renewing or extending the plan you already have is something you can do yourself; moving to a different one needs the learning team, so get in touch and we will sort it.',
    },
    {
      q: 'Do you offer plans for teams?',
      a: 'Not yet. Team access with shared billing and group reporting is something we are building. Register your interest and we will come back to you when it is ready.',
    },
  ];

  return (
    <section className="mt-20">
      <div className="grid gap-8 lg:grid-cols-[0.68fr_1.32fr] lg:gap-12">
        <div>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white" style={{ color: primaryColor, boxShadow: '0 8px 28px rgba(16,24,40,0.08)' }}>
            <MessageCircleQuestion className="h-5 w-5" />
          </span>
          <p className="mt-5 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: primaryColor }}>Clear answers</p>
          <h2
            className="mt-2 text-3xl font-black tracking-[-0.035em] sm:text-4xl"
            style={{ fontFamily: hFont, color: '#101828', textWrap: 'balance' }}
          >
            Questions before you choose?
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-6" style={{ color: '#667085' }}>
            Everything important about starting, paying, renewing, and keeping your progress.
          </p>

          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className="mt-6 inline-flex items-center gap-2 text-sm font-black underline underline-offset-4" style={{ color: primaryColor }}>
              Ask us anything
            </a>
          )}
        </div>

        <div className="grid gap-3">
          {faqs.map(faq => (
          <details
            key={faq.q}
            className="group rounded-2xl bg-white px-5 sm:px-6"
            style={{ boxShadow: '0 7px 24px rgba(16,24,40,0.055)' }}
          >
            <summary
              className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-sm font-black sm:text-base"
              style={{ color: '#101828', fontFamily: hFont }}
            >
              {faq.q}
              <ChevronDown
                className="w-4 h-4 flex-shrink-0 transition-transform group-open:rotate-180"
                style={{ color: primaryColor }}
                aria-hidden="true"
              />
            </summary>
            <p className="pb-5 text-sm leading-6" style={{ color: '#5F6B7A', maxWidth: '68ch' }}>
              {faq.a}
            </p>
          </details>
          ))}
        </div>
      </div>
    </section>
  );
}
