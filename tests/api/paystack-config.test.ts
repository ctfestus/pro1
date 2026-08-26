import { afterEach, describe, expect, it } from 'vitest';
import { paystackCallbackUrl, paystackIsConfigured, verifyPaystackSignature } from '@/lib/paystack';
import { PaymentError } from '@/lib/payment-errors';

const original = {
  appUrl: process.env.APP_URL,
  publicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
  secret: process.env.PAYSTACK_SECRET_KEY,
};

afterEach(() => {
  if (original.appUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = original.appUrl;
  if (original.publicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = original.publicAppUrl;
  if (original.secret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = original.secret;
});

describe('Paystack configuration', () => {
  it('requires a callback base URL before checkout initialization', () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(() => paystackCallbackUrl('sub-ref')).toThrow(PaymentError);
  });

  it('does not advertise checkout when the callback base URL is malformed', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_example';
    process.env.APP_URL = 'not a URL';
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(paystackIsConfigured()).toBe(false);
    expect(() => paystackCallbackUrl('sub-ref')).toThrow(PaymentError);
  });

  it('fails cleanly when webhook verification has no secret', () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(() => verifyPaystackSignature('{}', 'signature')).toThrow(PaymentError);
  });
});
