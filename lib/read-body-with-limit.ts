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

/**
 * Pass a response body through unbuffered, erroring the stream once more than `maxBytes` have gone
 * by. For bodies whose declared size was already checked: this guards against the declaration being
 * wrong without holding the whole body in memory (or in one oversized serverless response).
 */
export function limitBodyStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new Error('Body exceeds size limit'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}
