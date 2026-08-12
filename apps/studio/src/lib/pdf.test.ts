import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractText } from './pdf.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('extractText', () => {
  it('extracts text and page count from BOW PDF fixture', async () => {
    const fixture = new Uint8Array(
      await readFile(join(__dirname, '..', '..', 'tests', 'fixtures', 'BOW-[G7]-English.pdf'))
    )
    const result = await extractText(fixture)
    expect(result.pages).toBeGreaterThan(0)
    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
  })
})
