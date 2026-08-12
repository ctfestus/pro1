import { describe, expect, it } from 'vitest';
import { parseSubscriptionImportText } from '@/lib/subscription-import';

describe('parseSubscriptionImportText', () => {
  it('parses a CSV with optional row-level terms', () => {
    expect(parseSubscriptionImportText([
      'email,full_name,duration_months,amount,currency,due_date',
      'ada@example.com,"Ada Mensah",3,300,GHS,2026-09-30',
    ].join('\n'))).toEqual([{
      email: 'ada@example.com', full_name: 'Ada Mensah', duration_months: '3',
      amount: '300', currency: 'GHS', due_date: '2026-09-30',
    }]);
  });

  it('accepts plain pasted email addresses', () => {
    expect(parseSubscriptionImportText('ada@example.com\nkwame@example.com')).toEqual([
      { email: 'ada@example.com' }, { email: 'kwame@example.com' },
    ]);
  });

  it('supports email and name rows without a header', () => {
    expect(parseSubscriptionImportText('ada@example.com,"Ada, Mensah"')).toEqual([
      { email: 'ada@example.com', full_name: 'Ada, Mensah' },
    ]);
  });
});
