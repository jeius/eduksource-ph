import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractResponse } from '../schemas/extract.js'

const { mockedNimChat, mockedNimVisionChat } = vi.hoisted(() => ({
  mockedNimChat: vi.fn(),
  mockedNimVisionChat: vi.fn(),
}))

const { mockedExtractText } = vi.hoisted(() => ({
  mockedExtractText: vi.fn(),
}))

const { mockedExtractionCache } = vi.hoisted(() => ({
  mockedExtractionCache: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    hashFile: vi.fn(),
  },
}))

vi.mock('../lib/nim.js', () => ({
  nimChat: mockedNimChat,
  nimVisionChat: mockedNimVisionChat,
}))

vi.mock('../lib/pdf.js', () => ({
  extractText: mockedExtractText,
}))

vi.mock('../lib/cache.js', () => ({
  extractionCache: mockedExtractionCache,
}))

import { createExtractRoutes } from './extract.js'

describe('POST /api/extract', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api', createExtractRoutes())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-PDF with 400', async () => {
    const formData = new FormData()
    formData.append('file', new Blob(['not pdf'], { type: 'text/plain' }), 'test.txt')

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
  })

  it('rejects oversized file with 413', async () => {
    const largeBlob = new Blob([new Uint8Array(11 * 1024 * 1024)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', largeBlob, 'large.pdf')

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(413)
  })

  it('returns 413 for PDF with >50 pages', async () => {
    const pdfBlob = new Blob([new Uint8Array(1000)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', pdfBlob, 'test.pdf')

    mockedExtractText.mockResolvedValue({ text: 'test', pages: 51 })

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(413)
  })

  it('uses vision fallback when unpdf returns short text', async () => {
    const pdfBlob = new Blob([new Uint8Array(1000)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', pdfBlob, 'test.pdf')

    const validResponse = JSON.stringify({
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: 'CS',
          performanceStandard: 'PS',
          competencyGroups: [
            {
              topicLabel: 'Test Topic',
              subheading: 'Test Subheading',
              week: '1',
              competenciesRaw: '- Test competency',
            },
          ],
        },
      ],
    })
    mockedNimChat.mockResolvedValue(validResponse)
    mockedExtractText.mockResolvedValue({ text: 'short', pages: 1 })
    mockedNimVisionChat.mockResolvedValue('Extracted via vision')
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash123')

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(200)
    expect(mockedNimVisionChat).toHaveBeenCalled()
  })

  it('retries once on JSON parse failure then succeeds', async () => {
    const pdfBlob = new Blob([new Uint8Array(1000)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', pdfBlob, 'test.pdf')

    const validResponse = JSON.stringify({
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: 'CS',
          performanceStandard: 'PS',
          competencyGroups: [
            {
              topicLabel: 'Test Topic',
              subheading: null,
              week: '1',
              competenciesRaw: '- Test competency',
            },
          ],
        },
      ],
    })
    mockedNimChat.mockResolvedValueOnce('invalid json {').mockResolvedValueOnce(validResponse)
    mockedExtractText.mockResolvedValue({ text: 'A'.repeat(200), pages: 1 })
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash123')

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(200)
    expect(mockedNimChat).toHaveBeenCalledTimes(2)
  })

  it('returns 500 after retry still fails JSON parse', async () => {
    const pdfBlob = new Blob([new Uint8Array(1000)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', pdfBlob, 'test.pdf')

    mockedNimChat.mockResolvedValueOnce('invalid json {').mockResolvedValueOnce('still invalid {')
    mockedExtractText.mockResolvedValue({ text: 'A'.repeat(200), pages: 1 })
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash123')

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(500)
  })

  it('caches result and returns cached on second upload', async () => {
    const pdfBlob = new Blob([new Uint8Array(1000)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', pdfBlob, 'test.pdf')

    const validResponse = JSON.stringify({
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: 'CS',
          performanceStandard: 'PS',
          competencyGroups: [
            {
              topicLabel: 'Test Topic',
              subheading: null,
              week: '1',
              competenciesRaw: '- Test competency',
            },
          ],
        },
      ],
    })
    mockedNimChat.mockResolvedValue(validResponse)
    mockedExtractText.mockResolvedValue({ text: 'A'.repeat(200), pages: 1 })
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash123')

    const res1 = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })
    expect(res1.status).toBe(200)

    const formData2 = new FormData()
    formData2.append('file', pdfBlob, 'test.pdf')
    const cachedResponse: ExtractResponse = {
      text: 'cached',
      pages: 1,
      terms: [],
      warnings: [],
      notes: [],
    }
    mockedExtractionCache.get.mockReturnValue(cachedResponse)
    const res2 = await app.request('/api/extract', {
      method: 'POST',
      body: formData2,
    })
    expect(res2.status).toBe(200)

    expect(mockedNimChat).toHaveBeenCalledTimes(1)
  })

  it('returns valid groups + warnings on partial validation failure', async () => {
    const pdfBlob = new Blob([new Uint8Array(1000)], {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', pdfBlob, 'test.pdf')

    const mixedResponse = JSON.stringify({
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: 'CS',
          performanceStandard: 'PS',
          competencyGroups: [
            {
              topicLabel: 'Valid Topic',
              subheading: 'Sub',
              week: '1',
              competenciesRaw: '- valid',
            },
            {
              topicLabel: 123,
              subheading: 'Sub',
              week: '1',
              competenciesRaw: '- invalid',
            },
          ],
        },
      ],
    })
    mockedNimChat.mockResolvedValue(mixedResponse)
    mockedExtractText.mockResolvedValue({ text: 'A'.repeat(200), pages: 1 })
    mockedExtractionCache.get.mockReturnValue(undefined)
    mockedExtractionCache.hashFile.mockResolvedValue('hash123')

    const res = await app.request('/api/extract', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings.length).toBeGreaterThan(0)
    expect(body.terms[0].competencyGroups.length).toBe(1)
    expect(body.terms[0].competencyGroups[0].topicLabel).toBe('Valid Topic')
  })
})
