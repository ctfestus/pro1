'use client';

// The highlighted code shown on "code" questions. It lives in its own file so the course player
// loads the highlighting library (every language it knows) only when a course has a code question.

import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';

export default function CodeSnippet({ code, language, isDark }: { code: string; language: string; isDark: boolean }) {
  return (
    <SyntaxHighlighter
      language={language}
      style={isDark ? atomOneDark : atomOneLight}
      customStyle={{ margin: 0, borderRadius: 0, fontSize: '14px', lineHeight: '1.7', padding: '20px 24px', background: isDark ? '#0d1117' : '#fbfcfe' }}
      lineNumberStyle={{ color: isDark ? '#4b5563' : '#a1aab8', minWidth: '2.5em' }}
      showLineNumbers
    >
      {code}
    </SyntaxHighlighter>
  );
}
