import { createHash, randomBytes, randomUUID } from 'crypto';

export function newApplicationAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashApplicationAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newApplicationReference(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `APP-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function newApplicationId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
