import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHealthRoutes } from './health.js'

const { mockedNimChat, mockedNimChatStreamText } = vi.hoisted(() => ({
  mockedNimChat: vi.fn(),
  mockedNimChatStreamText: vi.fn(),
}))

vi.mock('../lib/nim.js', () => ({
  nimChat: mockedNimChat,
  nimChatStreamText: mockedNimChatStreamText,
}))

describe('createHealthRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 200 with status ok for `/`', async () => {
    const app = createHealthRoutes()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('returns 200 with status ok for `/nim`', async () => {
    mockedNimChat.mockResolvedValue('pong')
    const app = createHealthRoutes()
    const res = await app.request('/nim')
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toEqual('ok')
    expect(data.reply).toBe('pong')
    expect(mockedNimChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Reply with exactly: pong' }],
      expect.objectContaining({ model: expect.any(String) })
    )
  })

  it('returns 500 with status failed when NIM call throws', async () => {
    mockedNimChat.mockRejectedValue(new Error('NIM congestion'))
    const app = createHealthRoutes()
    const res = await app.request('/nim')
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.status).toEqual('failed')
    expect(data.error).toBe('NIM congestion')
  })

  it('returns SSE stream for `/nim/stream`', async () => {
    mockedNimChatStreamText.mockImplementation(async function* () {
      yield 'Why do programmers prefer dark mode?'
      yield 'Because light attracts bugs.'
    })
    const app = createHealthRoutes()
    const res = await app.request('/nim/stream')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const fullText = await res.text()
    expect(fullText).toContain('data:')
    expect(fullText).toContain('Why do programmers prefer dark mode?')
    expect(fullText).toContain('Because light attracts bugs.')
  })

  it('emits SSE error event when stream throws', async () => {
    mockedNimChatStreamText.mockImplementation(async function* () {
      throw new Error('stream failed')
    })
    const app = createHealthRoutes()
    const res = await app.request('/nim/stream')

    expect(res.status).toBe(200)
    const fullText = await res.text()
    expect(fullText).toContain('event: error')
    expect(fullText).toContain('stream failed')
  })
})
