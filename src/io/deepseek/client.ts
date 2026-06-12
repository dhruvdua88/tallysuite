/**
 * Hardened, strictly-optional DeepSeek client (SPEC §6.2). The app never needs a
 * key; this only runs when the user explicitly invokes an "AI review" and has
 * pasted a key. Hardening: JSON mode + zod validation with one repair round-trip,
 * exponential backoff on 429/5xx, model fallback chain, and a content-hash cache
 * so reruns/rehearsals cost nothing and cannot fail.
 */
import { z } from 'zod'
import { sha256Hex } from '../files'

const KEY_STORAGE = 'ddandco_deepseek_key'
const CACHE_PREFIX = 'ds_cache_'
const ENDPOINT = 'https://api.deepseek.com/chat/completions'
const MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}
export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim())
}
export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE)
}
export function hasApiKey(): boolean {
  return !!getApiKey()
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class DeepSeekError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Call DeepSeek and validate the JSON response against `schema`. Retries with
 * backoff on transient errors, one repair round-trip on schema mismatch, and
 * falls back to the next model after repeated hard failures. Caches by content.
 */
export async function callJSON<T>(
  messages: Message[],
  schema: z.ZodType<T>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const key = getApiKey()
  if (!key) throw new DeepSeekError('No DeepSeek API key configured.')

  const cacheKey = CACHE_PREFIX + (await sha256Hex(new TextEncoder().encode(JSON.stringify(messages))))
  const cached = readCache(cacheKey)
  if (cached) {
    const parsed = schema.safeParse(cached)
    if (parsed.success) return parsed.data
  }

  let lastErr: unknown
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await rawCall(key, model, messages, opts)
        const json = JSON.parse(raw)
        const parsed = schema.safeParse(json)
        if (parsed.success) {
          writeCache(cacheKey, json)
          return parsed.data
        }
        // one repair round-trip
        const repaired = await rawCall(
          key,
          model,
          [
            ...messages,
            { role: 'assistant', content: raw },
            {
              role: 'user',
              content: `Your JSON failed validation: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}. Return ONLY corrected JSON matching the schema.`,
            },
          ],
          opts,
        )
        const reparsed = schema.safeParse(JSON.parse(repaired))
        if (reparsed.success) {
          writeCache(cacheKey, reparsed.data)
          return reparsed.data
        }
        lastErr = new DeepSeekError('Schema validation failed after repair.')
      } catch (e) {
        lastErr = e
        const status = (e as { status?: number }).status
        // non-retryable (auth/bad request) → break to next model only on 5xx/429/network
        if (status && status !== 429 && status < 500) throw e
        await sleep([1000, 4000, 15000][attempt] ?? 15000)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new DeepSeekError('DeepSeek call failed.')
}

async function rawCall(
  key: string,
  model: string,
  messages: Message[],
  opts: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90000)
  if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const err = new DeepSeekError(`DeepSeek HTTP ${res.status}`) as DeepSeekError & { status: number }
      err.status = res.status
      throw err
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new DeepSeekError('Empty response from DeepSeek.')
    return content
  } finally {
    clearTimeout(timeout)
  }
}

function readCache(k: string): unknown {
  try {
    const v = localStorage.getItem(k)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}
function writeCache(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* quota — ignore */
  }
}
