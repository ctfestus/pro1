'use client';
import { createContext, useContext } from 'react';
import { tenant } from '@/lib/tenant';
import type { TenantSettings } from '@/lib/get-tenant-settings';

export type TenantBranding = TenantSettings & {
  headingFont?: string;
  bodyFont?: string;
};

const TenantContext = createContext<TenantBranding>(tenant);

export function TenantProvider({
  children,
  initialSettings,
}: {
  children: React.ReactNode;
  initialSettings: TenantBranding;
}) {
  return <TenantContext.Provider value={initialSettings}>{children}</TenantContext.Provider>;
}

export const useTenant = () => useContext(TenantContext);
