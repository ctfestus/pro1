export type PaymentErrorCode =
  | 'configuration_error'
  | 'conflict'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'validation_error';

export class PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export function paymentErrorResponse(error: unknown, fallback: string) {
  if (error instanceof PaymentError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  console.error('[payments]', error);
  return { message: fallback, status: 500, code: 'internal_error' };
}
