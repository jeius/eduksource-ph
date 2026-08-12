import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { nimVisionChat } from './nim.js'

describe('nimVisionChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls NIM vision model with base64 image and prompt', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Extracted text from image' } }],
    })

    const result = await nimVisionChat('base64image', 'Extract text')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract text' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,base64image' } },
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

    const result = await nimVisionChat('base64image', 'Extract text')
    expect(result).toBe('')
  })
})
