import OpenAI from 'openai'
import type { Stream } from 'openai/streaming'
import { env } from '../config/env.js'

const API_KEY = env.NVIDIA_API_KEY
const baseURL = env.NVIDIA_NIM_BASE_URL
export const defaultModel = env.NIM_MODEL_REASONING
const ocrModel = env.NIM_MODEL_OCR

type ChatCreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

type ChatOptions = Omit<ChatCreateParams, 'messages' | 'stream'>

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

async function createCompletion(
  messages: ChatMessage[],
  opts: ChatOptions,
  stream: true
): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>>
async function createCompletion(
  messages: ChatMessage[],
  opts: ChatOptions,
  stream: false
): Promise<OpenAI.Chat.Completions.ChatCompletion>
async function createCompletion(
  messages: ChatMessage[],
  opts: ChatOptions,
  stream: boolean
): Promise<
  OpenAI.Chat.Completions.ChatCompletion | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
> {
  const openai = new OpenAI({ apiKey: API_KEY, baseURL })
  return openai.chat.completions.create({
    ...opts,
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: opts.max_completion_tokens ?? 8192,
    top_p: opts.top_p ?? 0.95,
    stream,
  })
}

export async function nimChat(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel }
) {
  const completion = await createCompletion(messages, opts, false)

  const content = completion.choices[0]?.message.content

  return content
}

export type NimUsage = { input: number; output: number }

export async function nimChatDetailed(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel }
): Promise<{ content: string | null; usage: NimUsage; finishReason: string | null }> {
  const completion = await createCompletion(messages, opts, false)

  return {
    content: completion.choices[0]?.message.content ?? null,
    usage: {
      input: completion.usage?.prompt_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
    },
    finishReason: completion.choices[0]?.finish_reason ?? null,
  }
}

export async function nimChatStream(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel }
): Promise<ReadableStream> {
  const completion = await createCompletion(messages, opts, true)

  return completion.tee()[1].toReadableStream()
}

export async function* nimChatStreamText(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel }
) {
  const res = await nimChatStream(messages, opts)
  const reader = res.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the last (possibly incomplete) line for next chunk

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) yield delta as string
      } catch {
        // incomplete/malformed chunk, skip
      }
    }
  }
}

export async function nimVisionChat(pages: string[], prompt: string): Promise<string> {
  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: baseURL,
  })

  const completion = await openai.chat.completions.create({
    model: ocrModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...pages.map((b64) => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      },
    ],
    temperature: 0.1,
    max_completion_tokens: 8192,
  })

  return completion.choices[0]?.message.content ?? ''
}
