import { describe, expect, it } from 'vitest';
import { SystemFieldsSchema } from './system-fields.js';

const full = {
  teacherName: 'Maiza R. Evangelista',
  sectionLabel: '11-Tesla',
  gradeLevel: 'Grade 11',
  learningArea: 'Life and Career Skills',
  generationMetadata: { provider: 'nim', model: 'test-model', generatedAt: '2026-08-27T00:00:00Z' },
  bowReference: 'DepEd BOW — First Term, Week 1',
  preparedBy: 'Maiza R. Evangelista',
  checkedBy: 'Janice P. Enriquez',
  notedBy: 'Hazel Y. Manalo PhD',
  checkedByRole: 'Head Teacher III',
  notedByRole: 'Principal IV',
  letterhead: { lines: ['Republic of the Philippines', 'Department of Education'] },
};

describe('SystemFieldsSchema', () => {
  it('accepts the full shape including signature + letterhead fields', () => {
    expect(() => SystemFieldsSchema.parse(full)).not.toThrow();
  });

  it('accepts the minimal PPTX-era shape (signatures/letterhead omitted)', () => {
    const { preparedBy, checkedBy, notedBy, checkedByRole, notedByRole, letterhead, ...minimal } =
      full;
    void preparedBy;
    void checkedBy;
    void notedBy;
    void checkedByRole;
    void notedByRole;
    void letterhead;
    expect(() => SystemFieldsSchema.parse(minimal)).not.toThrow();
  });

  it('accepts null teacherName/sectionLabel (fill-blank path)', () => {
    expect(() =>
      SystemFieldsSchema.parse({ ...full, teacherName: null, sectionLabel: null })
    ).not.toThrow();
  });

  it('requires gradeLevel, learningArea, bowReference and generationMetadata', () => {
    const bad = { ...full } as Record<string, unknown>;
    delete bad.gradeLevel;
    expect(SystemFieldsSchema.safeParse(bad).success).toBe(false);
  });
});
