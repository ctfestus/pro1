import type { ReactNode } from 'react';

// Admin pages focus in the shared blue (see .admin-focus in globals.css). `contents` keeps the
// wrapper out of the page layout.
export default function AdminFocusLayout({ children }: { children: ReactNode }) {
  return <div className="admin-focus contents">{children}</div>;
}
