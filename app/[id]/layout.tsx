// Link-preview metadata lives in page.tsx, which (unlike a layout) receives ?catalogueType=.
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
