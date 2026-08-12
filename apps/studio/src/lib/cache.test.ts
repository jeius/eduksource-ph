import { describe, expect, it } from 'vitest'
import type { ExtractResponse } from '../schemas/extract.js'
import { ExtractionCache, extractionCache } from './cache.js'

describe('ExtractionCache', () => {
  it('stores and retrieves by hash', async () => {
    const cache = new ExtractionCache()
    const hash = await cache.hashFile(new Uint8Array([1, 2, 3]))
    const payload: ExtractResponse = { text: 'x', pages: 1, terms: [], warnings: [], notes: [] }
    cache.set(hash, payload)
    const got = cache.get(hash)
    expect(got).toEqual(payload)
  })

  it('returns undefined for missing key', () => {
    const cache = new ExtractionCache()
    expect(cache.get('nonexistent')).toBeUndefined()
  })

  it('computes consistent SHA-256 hash', async () => {
    const cache = new ExtractionCache()
    const buffer = new Uint8Array([1, 2, 3, 4, 5])
    const hash1 = await cache.hashFile(buffer)
    const hash2 = await cache.hashFile(buffer)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex length
  })

  it('clears all entries', async () => {
    const cache = new ExtractionCache()
    const hash = await cache.hashFile(new Uint8Array([1]))
    cache.set(hash, { text: 'x', pages: 1, terms: [], warnings: [], notes: [] })
    cache.clear()
    expect(cache.get(hash)).toBeUndefined()
  })

  it('exported singleton works', async () => {
    const hash = await extractionCache.hashFile(new Uint8Array([9, 9, 9]))
    const payload: ExtractResponse = { text: 'y', pages: 2, terms: [], warnings: [], notes: [] }
    extractionCache.set(hash, payload)
    expect(extractionCache.get(hash)).toEqual(payload)
  })
})
