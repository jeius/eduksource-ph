import { Hono } from 'hono'

export function createHealthRoutes() {
  const health = new Hono()

  health.get('/', (c) => {
    return c.json({ status: 'ok' })
  })

  return health
}
