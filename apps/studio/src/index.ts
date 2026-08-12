import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createHealthRoutes } from './routes/health.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/health', createHealthRoutes())

export default app

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000

  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`)
    }
  )
}
