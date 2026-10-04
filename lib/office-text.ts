// Plain-text extraction from Office Open XML files (.docx, .pptx) for AI review prompts.
// Both formats are zip archives of XML; this reads the text runs and keeps paragraph breaks.
// Legacy binary .doc/.ppt are not supported.

import JSZip from 'jszip';

const MAX_CHARS = 300_000;
// .docx/.pptx/.xlsx are compressed; a small upload can expand enormously when read.
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export class ArchiveTooLargeError extends Error {}

// JSZip's per-entry stream. It exists at runtime but is missing from the package's type definitions.
interface EntryStream {
  on(event: 'data', cb: (chunk: Uint8Array) => void): EntryStream;
  on(event: 'end', cb: () => void): EntryStream;
  on(event: 'error', cb: (err: Error) => void): EntryStream;
  pause(): EntryStream;
  resume(): EntryStream;
}

// Reject an archive that unpacks to more than maxBytes, before any extractor inflates it whole.
//
// The sizes a zip declares cannot be trusted: a crafted file can claim 100 bytes and expand to
// gigabytes, and JSZip only compares the claim with the real output after it has produced all of
// it. So the declared sizes are a cheap first check, and then every entry is actually inflated as a
// stream with a running byte count that stops the moment it passes the limit. Chunks are counted and
// dropped, so memory stays flat however large the claim.
export async function assertZipWithinLimit(buffer: ArrayBuffer, maxBytes = MAX_UNCOMPRESSED_BYTES): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter(entry => !entry.dir);

  let declared = 0;
  for (const entry of entries) {
    const size = (entry as any)._data?.uncompressedSize;
    // An empty part has no recorded size. Count it as 0; the streaming pass below counts real bytes.
    declared += typeof size === 'number' ? size : 0;
    if (declared > maxBytes) throw new ArchiveTooLargeError('Archive expands beyond the size limit');
  }

  let actual = 0;
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const stream = (entry as unknown as { internalStream(type: 'uint8array'): EntryStream }).internalStream('uint8array');
      let stopped = false;
      stream
        .on('data', chunk => {
          if (stopped) return;
          actual += chunk.length;
          if (actual > maxBytes) {
            stopped = true;
            stream.pause();
            reject(new ArchiveTooLargeError('Archive expands beyond the size limit'));
          }
        })
        .on('error', err => { if (!stopped) { stopped = true; reject(err); } })
        .on('end', () => { if (!stopped) resolve(); })
        .resume();
    });
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

// Join the text runs (<w:t> / <a:t>) of each paragraph (<w:p> / <a:p>) into one line.
function paragraphsText(xml: string, ns: 'w' | 'a'): string {
  const paraRe = new RegExp(`<${ns}:p[\\s>][\\s\\S]*?</${ns}:p>`, 'g');
  const runRe = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>`, 'g');
  const lines: string[] = [];
  for (const para of xml.match(paraRe) ?? []) {
    let line = '';
    for (const m of para.matchAll(runRe)) line += decodeXml(m[1]);
    if (line.trim()) lines.push(line);
  }
  return lines.join('\n');
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Not a valid .docx file');
  return paragraphsText(xml, 'w').slice(0, MAX_CHARS);
}

export async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNum = (name: string) => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNum(a) - slideNum(b));
  if (slides.length === 0) throw new Error('Not a valid .pptx file');

  const parts: string[] = [];
  for (const name of slides) {
    const xml = await zip.file(name)!.async('string');
    parts.push(`Slide ${slideNum(name)}:\n${paragraphsText(xml, 'a') || '(no text)'}`);
  }
  return parts.join('\n\n').slice(0, MAX_CHARS);
}
