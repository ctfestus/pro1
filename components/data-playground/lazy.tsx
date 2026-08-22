'use client';

// Lazy wrappers around the Data Playground surface.
//
// DataPlayground.tsx statically imports the full CodeMirror editor stack (autocomplete,
// commands, language, lang-sql, state, view, one-dark) plus papaparse, because the dataset
// detail pane has a live SQL console. That console is several clicks deep, but the static
// import put all of it in the first load of /data-playground and -- through the student
// Data Center section -- of /student too.
//
// WhatsAppCommunityBanner is lazy for the same reason even though it is tiny: it lives in
// the same module, so importing it eagerly would pull CodeMirror straight back in. It
// renders nothing until a tenant sets the link, so its placeholder is deliberately null.

import dynamic from 'next/dynamic';

export const DataPlaygroundGrid = dynamic(
  () => import('@/components/data-playground/DataPlayground').then(m => m.DataPlaygroundGrid),
  {
    ssr: false,
    // The grid renders its own skeleton cards while datasets load; this only covers the
    // brief chunk fetch before that, so keep it the same neutral block shape.
    loading: () => <div style={{ minHeight: 320, borderRadius: 16, background: 'rgba(127,127,127,0.06)' }} />,
  },
);

export const WhatsAppCommunityBanner = dynamic(
  () => import('@/components/data-playground/DataPlayground').then(m => m.WhatsAppCommunityBanner),
  { ssr: false, loading: () => null },
);
