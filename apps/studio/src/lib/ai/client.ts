import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import {
  getConfiguredProviders,
  getPrimaryProvider,
  type ProviderConfig,
  resolveModel,
  resolveModelList,
  type TaskType,
} from './providers.js';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ChatOptions {
  model?: string;
  task?: TaskType;
  temperature?: number;
  top_p?: number;
  max_completion_tokens?: number;
}

export type ChatUsage = { input: number; output: number };

export interface ChatDetailedResult {
  content: string | null;
  usage: ChatUsage;
  finishReason: string | null;
}

type ChatRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'stream'
> & {
  stream?: boolean;
  extra_body?: { models: string[] };
};

function createClient(provider: ProviderConfig): OpenAI {
  return new OpenAI({ apiKey: provider.apiKey ?? '', baseURL: provider.baseURL ?? '' });
}

async function runWithFallback<T>(
  task: TaskType,
  explicitModel: string | undefined,
  fn: (provider: ProviderConfig, model: string) => Promise<T>
): Promise<T> {
  const configured = getConfiguredProviders();
  const primary = getPrimaryProvider();
  const chain = [primary, ...configured.filter((p) => p.name !== primary.name)];

  let lastError: unknown;
  for (const provider of chain) {
    let model: string;
    try {
      model = provider === primary && explicitModel ? explicitModel : resolveModel(provider, task);
    } catch {
      continue; // provider has no model for this task — skip it, never fatal
    }
    try {
      return await fn(provider, model);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`No provider could handle task "${task}"`);
}

function buildBody(
  messages: ChatMessage[],
  opts: ChatOptions,
  model: string,
  stream: boolean
): ChatRequest {
  return {
    model,
    messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: opts.max_completion_tokens ?? 8192,
    top_p: opts.top_p ?? 0.95,
    stream,
  };
}

function modelListOptions(
  provider: ProviderConfig,
  task: TaskType
): { extra_body: { models: string[] } } | undefined {
  if (provider.name !== 'openrouter') return undefined;
  const list = resolveModelList(provider, task);
  if (!list || list.length < 2) return undefined;
  return { extra_body: { models: list } };
}

async function complete(
  provider: ProviderConfig,
  body: ChatRequest,
  options?: { extra_body: { models: string[] } }
) {
  const client = createClient(provider);
  const params = body as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
  if (options) {
    return client.chat.completions.create(params, options as OpenAI.RequestOptions);
  }
  return client.chat.completions.create(params);
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string | null> {
  const task = opts.task ?? 'extraction';
  const result = await runWithFallback(task, opts.model, async (provider, model) => {
    const body = buildBody(messages, opts, model, false);
    const completion = await complete(provider, body, modelListOptions(provider, task));
    return completion.choices[0]?.message.content ?? null;
  });
  return result;
}

export async function chatDetailed(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ChatDetailedResult> {
  const task = opts.task ?? 'extraction';
  return runWithFallback(task, opts.model, async (provider, model) => {
    const body = buildBody(messages, opts, model, false);
    const completion = await complete(provider, body, modelListOptions(provider, task));
    return {
      content: completion.choices[0]?.message.content ?? null,
      usage: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0,
      },
      finishReason: completion.choices[0]?.finish_reason ?? null,
    };
  });
}

export async function chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ReadableStream> {
  const task = opts.task ?? 'extraction';
  const completion = await runWithFallback(task, opts.model, async (provider, model) => {
    const body = buildBody(messages, opts, model, true);
    return complete(provider, body, modelListOptions(provider, task));
  });
  const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> =
    completion as unknown as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
  return stream.tee()[1].toReadableStream();
}

export async function* chatStreamText(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<string> {
  const res = await chatStream(messages, opts);
  const reader = res.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const DONE = Symbol('done');

  function* processBuffer(): Generator<string, typeof DONE | undefined> {
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return DONE;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // incomplete/malformed chunk, skip
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    if ((yield* processBuffer()) === DONE) return;
  }

  if ((yield* processBuffer()) === DONE) return;
}

export async function visionChat(pages: string[], prompt: string): Promise<string> {
  return runWithFallback('ocr', undefined, async (provider, model) => {
    const body: ChatRequest = {
      model,
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
    };
    const completion = await complete(provider, body);
    return completion.choices[0]?.message.content ?? '';
  });
}
