import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { env } from '../config/env.js'
import { nimChat, nimChatStreamText } from '../lib/nim.js'

export function createHealthRoutes() {
  const health = new Hono()

  health.get('/', (c) => {
    return c.json({ status: 'ok' }, 200)
  })

  health.get('/nim', async (c) => {
    try {
      const reply = await nimChat([{ role: 'user', content: 'Reply with exactly: pong' }], {
        model: env.NIM_MODEL_REASONING,
      })
      return c.json({ status: 'ok', reply }, 200)
    } catch (err) {
      return c.json({ status: 'failed', error: (err as Error).message }, 500)
    }
  })

  health.get('/nim/stream', async (c) => {
    return streamSSE(c, async (sseStream) => {
      try {
        for await (const chunk of nimChatStreamText(
          [{ role: 'user', content: 'Write me a dad joke for developers...' }],
          { model: env.NIM_MODEL_REASONING }
        )) {
          await sseStream.writeSSE({ data: chunk })
        }
      } catch (err) {
        await sseStream.writeSSE({
          event: 'error',
          data: (err as Error).message,
        })
      }
    })
  })

  return health
}
