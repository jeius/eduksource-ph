import OpenAI from "openai";
import { env } from "../config/env.js";

const API_KEY = env.NVIDIA_API_KEY;
const baseURL = env.NVIDIA_NIM_BASE_URL;
const defaultModel = env.NIM_MODEL_REASONING;

type ChatCreateParams =
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

type ChatOptions = Omit<ChatCreateParams, "messages" | "stream">;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function nimChat(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel },
) {
  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: baseURL,
  });

  const completion = await openai.chat.completions.create({
    ...opts,
    model: opts.model,
    messages: messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: opts.max_completion_tokens ?? 8192,
    top_p: opts.top_p ?? 0.95,
    stream: false,
  });

  const content = completion.choices[0]?.message.content;

  return content;
}

export async function nimChatStream(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel },
): Promise<ReadableStream> {
  const openai = new OpenAI({
    apiKey: API_KEY,
    baseURL: baseURL,
  });

  const completion = await openai.chat.completions.create({
    ...opts,
    model: opts.model,
    messages: messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: opts.max_completion_tokens ?? 8192,
    top_p: opts.top_p ?? 0.95,
    stream: true,
  });

  return completion.tee()[1].toReadableStream();
}

export async function* nimChatStreamText(
  messages: ChatMessage[],
  opts: ChatOptions = { model: defaultModel },
) {
  const res = await nimChatStream(messages, opts);
  const reader = res.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep the last (possibly incomplete) line for next chunk

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // incomplete/malformed chunk, skip
      }
    }
  }
}
