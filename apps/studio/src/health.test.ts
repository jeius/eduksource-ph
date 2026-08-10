import { describe, expect, it } from 'vitest'
import { createHealthRoutes } from './health.js'

describe('createHealthRoutes', () => {
  it('returns 200 with status ok', async () => {
    const app = createHealthRoutes()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
