import { serve } from '@hono/node-server'
import { honoLogLayer } from '@loglayer/hono'
import { Hono } from 'hono'
import { prettyJSON } from 'hono/pretty-json'
import { env } from './config/env.js'
import { createLogger } from './config/logger.js'
import type { HonoSchema } from './lib/types.js'
import { errorHandler } from './middlewares/errorHandler.js'
import { createHealthRoutes } from './routes/health.js'

const app = new Hono<HonoSchema>()

/********* Middlewares *********/
// Logger
app.use(honoLogLayer({ instance: createLogger() }))

// Pretty JSON
app.use(prettyJSON({ space: 2 }))

// Error Handler
app.onError(errorHandler())

/********* Routes *********/
app.route('/health', createHealthRoutes())

app.get('/', (c) => {
  return c.text('Hello Hono!')
})


export default app

if (import.meta.main) {
  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      createLogger()
        .withPrefix('[SYSTEM]')
        .withMetadata(info)
        .info(`Server is running on http://localhost:${info.port}`)
    }
  )
}
