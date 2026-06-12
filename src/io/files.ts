/**
 * io/files — the impure boundary that turns a user-selected File into bytes and
 * a cryptographic content hash (tamper identity), then hands them to the pure
 * ingestion core. This is the only place WebCrypto / File APIs are used.
 */
import { parseTallyZip } from '../core/ingest/xlsxZip'
import type { NormalizedDataset } from '../core/model/dataset'
import type { IngestionReport } from '../core/ingest/report'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the view's buffer type satisfies the
  // SubtleCrypto BufferSource signature (handles SharedArrayBuffer-typed views).
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function ingestFile(
  file: File,
): Promise<{ dataset: NormalizedDataset; report: IngestionReport }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentHash = await sha256Hex(bytes)
  const name = file.name
  if (/\.zip$/i.test(name)) {
    return parseTallyZip(bytes, { sourceFile: name, contentHash })
  }
  throw new Error(
    `Unsupported file "${name}". Drop a Tally export ZIP (.zip). SQLite support coming next.`,
  )
}
