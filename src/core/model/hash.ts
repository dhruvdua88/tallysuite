/**
 * Fast, synchronous, deterministic string hash (FNV-1a, 64-bit) used for
 * voucher content fingerprints in the diff engine. Non-cryptographic by design:
 * it only needs to be stable and collision-resistant enough to detect "did this
 * voucher change". Cryptographic source-bytes hashing (tamper identity) is done
 * in io/ via WebCrypto and passed into ingest as meta.contentHash.
 */
const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

export function fnv1a(input: string): string {
  let h = OFFSET
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i))
    h = (h * PRIME) & MASK
  }
  return h.toString(16).padStart(16, '0')
}
