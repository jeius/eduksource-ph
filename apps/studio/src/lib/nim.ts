import {
  type ChatMessage,
  type ChatOptions,
  type ChatUsage,
  chat,
  chatDetailed,
  chatStream,
  chatStreamText,
  visionChat,
} from './ai/client.js';
import { getPrimaryProvider, resolveModel } from './ai/providers.js';

export type NimUsage = ChatUsage;

export const defaultModel = resolveModel(getPrimaryProvider(), 'extraction');

export async function nimChat(messages: ChatMessage[], opts: ChatOptions = {}) {
  return chat(messages, opts);
}

export async function nimChatDetailed(messages: ChatMessage[], opts: ChatOptions = {}) {
  return chatDetailed(messages, opts);
}

export async function nimChatStream(messages: ChatMessage[], opts: ChatOptions = {}) {
  return chatStream(messages, opts);
}

export async function* nimChatStreamText(messages: ChatMessage[], opts: ChatOptions = {}) {
  yield* chatStreamText(messages, opts);
}

export async function nimVisionChat(pages: string[], prompt: string): Promise<string> {
  return visionChat(pages, prompt);
}
