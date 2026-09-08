// One MiB per API JSON body, counted in bytes (including chunked transfers).
// This transport ceiling applies in addition to the per-field schema limits.
export const MAX_JSON_BYTES = 1024 * 1024;
export class BodyTooLarge extends Error {}

export async function readRequestJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_JSON_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw new BodyTooLarge();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
