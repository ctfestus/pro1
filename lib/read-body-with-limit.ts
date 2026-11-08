/**
 * Read a fetch Response body, giving up as soon as it passes `maxBytes`.
 *
 * A declared Content-Length can be missing or wrong, so the limit is enforced on the bytes actually
 * received: an oversized body is cancelled mid-stream instead of being buffered whole and rejected
 * afterwards. Returns null when the limit was exceeded.
 */
export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<ArrayBuffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('Body exceeds size limit');
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new ArrayBuffer(total);
  const view = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
