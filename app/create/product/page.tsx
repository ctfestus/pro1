'use client';

import { Suspense } from 'react';
import { BookEditor } from '@/components/books/editor/BookEditor';

export default function BookCreatePage() {
  return (
    <Suspense fallback={null}>
      <BookEditor />
    </Suspense>
  );
}
