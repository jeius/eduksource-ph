import { describe, expect, it } from 'vitest'
import {
  type BowCompetencyGroup,
  BowCompetencyGroupSchema,
  type BowTerm,
  BowTermSchema,
  type ExtractResponse,
  ExtractResponseSchema,
} from './extract.js'

describe('extract schemas', () => {
  it('validates valid response with all terms', () => {
    const valid = {
      text: 'extracted text',
      pages: 5,
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: 'Content standard text',
          performanceStandard: 'Performance standard text',
          competencyGroups: [
            {
              topicLabel: 'Literary Text | Poetry and Prose',
              subheading: 'Evaluating literary texts',
              week: '1',
              competenciesRaw:
                '- Analyze poem structure\n  - Identify rhyme scheme\n- Evaluate themes',
            },
          ],
        },
      ],
      warnings: [],
      notes: [],
    }
    expect(ExtractResponseSchema.parse(valid)).toEqual(valid)
  })

  it("validates response with week='*' and null subheading", () => {
    const valid = {
      text: 'extracted text',
      pages: 1,
      terms: [
        {
          termLabel: 'First Term',
          contentStandard: 'Content standard',
          performanceStandard: 'Performance standard',
          competencyGroups: [
            {
              topicLabel: 'Some Topic',
              subheading: null,
              week: '*',
              competenciesRaw: '- Competency with star week',
            },
          ],
        },
      ],
      warnings: [],
      notes: [],
    }
    expect(ExtractResponseSchema.parse(valid)).toEqual(valid)
  })

  it('rejects missing required fields', () => {
    expect(() => ExtractResponseSchema.parse({})).toThrow()
    expect(() => ExtractResponseSchema.parse({ text: 'x' })).toThrow()
    expect(() => ExtractResponseSchema.parse({ text: 'x', pages: 1 })).toThrow()
  })

  it('validates BowCompetencyGroupSchema', () => {
    const group = {
      topicLabel: 'Topic',
      subheading: 'Subheading',
      week: '2',
      competenciesRaw: '- Item 1\n  - Subitem',
    }
    expect(BowCompetencyGroupSchema.parse(group)).toEqual(group)
  })

  it('validates BowTermSchema', () => {
    const term = {
      termLabel: 'First Term',
      contentStandard: 'CS',
      performanceStandard: 'PS',
      competencyGroups: [],
    }
    expect(BowTermSchema.parse(term)).toEqual(term)
  })

  it('infers correct types', () => {
    const response: ExtractResponse = {
      text: 'x',
      pages: 1,
      terms: [
        {
          termLabel: 'T',
          contentStandard: 'c',
          performanceStandard: 'p',
          competencyGroups: [],
        },
      ],
      warnings: [],
      notes: [],
    }
    expect(response.pages).toBe(1)

    const term: BowTerm = {
      termLabel: 'T',
      contentStandard: 'c',
      performanceStandard: 'p',
      competencyGroups: [{ topicLabel: 't', subheading: null, week: '1', competenciesRaw: 'r' }],
    }
    expect(term.termLabel).toBe('T')

    const group: BowCompetencyGroup = {
      topicLabel: 't',
      subheading: null,
      week: '*',
      competenciesRaw: 'r',
    }
    expect(group.week).toBe('*')
  })
})
