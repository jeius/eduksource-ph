import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreate = vi.fn()

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  }
  return { default: MockOpenAI }
})

import { nimChatDetailed, nimVisionChat } from './nim.js'

describe('nimChatDetailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns content and usage metadata', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
    })

    const result = await nimChatDetailed([{ role: 'user', content: 'hi' }])

    expect(result.content).toBe('{"ok":true}')
    expect(result.usage).toEqual({ input: 120, output: 45 })
    expect(result.finishReason).toBe('stop')
  })

  it('surfaces a length finish reason (output truncated)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"trunc' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 8192, total_tokens: 8202 },
    })

    const result = await nimChatDetailed([{ role: 'user', content: 'hi' }])
    expect(result.finishReason).toBe('length')
    expect(result.content).toBe('{"trunc')
  })

  it('returns null content and zero usage when absent', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: undefined,
    })

    const result = await nimChatDetailed([{ role: 'user', content: 'hi' }])
    expect(result.content).toBeNull()
    expect(result.usage).toEqual({ input: 0, output: 0 })
    expect(result.finishReason).toBeNull()
  })
})

describe('nimVisionChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends every page as an image_url part', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Extracted text from image' } }],
    })

    const result = await nimVisionChat(['img1', 'img2'], 'Extract text')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract text' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,img2' } },
            ],
          },
        ],
        temperature: 0.1,
        max_completion_tokens: 8192,
      })
    )
    expect(result).toBe('Extracted text from image')
  })

  it('returns empty string when no content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    })
    const result = await nimVisionChat(['img'], 'Extract text')
    expect(result).toBe('')
  })
})
