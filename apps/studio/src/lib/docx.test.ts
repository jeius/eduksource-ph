import type { LessonPlanResponse } from '@eduksource/schemas/lesson-plan.js';
import { TEACHER_FILL_BLANK, TEACHER_FILL_NOTE } from '@eduksource/schemas/studio-constants.js';
import type { SystemFields } from '@eduksource/schemas/system-fields.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { assembleDocx } from './docx.js';

const lp: LessonPlanResponse = {
  meta: {
    lessonTitle: 'Understanding developmental stages',
    numberOfSessions: 2,
    referencesFromBow: ['https://example.com/quexbook'],
  },
  intentions: {
    learningCompetencyAndStandards: {
      contentStandard: ['The learner demonstrates understanding of developmental stages.'],
      performanceStandard: ['The learner manages the different aspects of self.'],
      learningCompetency: 'Examine developmental stages and tasks.',
    },
    sessions: [
      {
        sessionLabel: 'Session 1',
        learningObjectives: ['identify stages'],
        learnerContext: 'visual learners',
      },
      {
        sessionLabel: 'Session 2',
        learningObjectives: ['map careers'],
        learnerContext: 'career focus',
      },
    ],
  },
  learningExperience: {
    sessions: [
      {
        sessionLabel: 'Session 1',
        preLesson: 'Greetings & Recall',
        flow: 'Teacher presents objectives → wellness check → peer sharing.',
        learningResources: ['Slides'],
        opportunitiesForIntegration: 'N/A',
      },
      {
        sessionLabel: 'Session 2',
        preLesson: 'Recall',
        flow: 'Career mapping workshop.',
        learningResources: [],
        opportunitiesForIntegration: 'ICT: tagline',
      },
    ],
  },
  assessment: {
    sessions: [
      { sessionLabel: 'Session 1', formativeAssessment: 'MCQ on Erikson stages.' },
      { sessionLabel: 'Session 2', formativeAssessment: 'Reflective journal entry.' },
    ],
  },
  waysForward: {
    sessions: [
      {
        sessionLabel: 'Session 1',
        extendedLearningOpportunities: 'Family observation walk.',
        reflections: null,
      },
      {
        sessionLabel: 'Session 2',
        extendedLearningOpportunities: 'Interview a professional.',
        reflections: null,
      },
    ],
  },
};

const baseFields: SystemFields = {
  teacherName: 'Maiza R. Evangelista',
  sectionLabel: '11-Tesla',
  gradeLevel: 'Grade 11',
  learningArea: 'Life and Career Skills',
  generationMetadata: { provider: 'nim', model: 'test-model', generatedAt: '2026-08-27T00:00:00Z' },
  bowReference: 'Official DepEd Three-Term Budget of Work Week 1-2',
  preparedBy: 'Maiza R. Evangelista',
  checkedBy: 'Janice P. Enriquez',
  notedBy: 'Hazel Y. Manalo PhD',
  checkedByRole: 'Head Teacher III',
  notedByRole: 'Principal IV',
  letterhead: { lines: ['Republic of the Philippines', 'Department of Education'] },
};

/** Extract word/document.xml from the assembled zip and verify our controlled strings. */
async function packXml(doc: unknown): Promise<string> {
  const { Packer } = await import('docx');
  const { inflateRawSync } = await import('node:zlib');
  const buf = await Packer.toBuffer(doc as Parameters<typeof Packer.toBuffer>[0]);
  const u8 = new Uint8Array(buf);
  let start = 0;
  while (start < u8.length - 30) {
    const sig =
      u8[start] === 0x50 &&
      u8[start + 1] === 0x4b &&
      u8[start + 2] === 0x03 &&
      u8[start + 3] === 0x04;
    if (!sig) {
      start += 1;
      continue;
    }
    const i = start;
    const method = u8[i + 8] ?? 0;
    const compSize =
      (u8[i + 18] ?? 0) |
      ((u8[i + 19] ?? 0) << 8) |
      ((u8[i + 20] ?? 0) << 16) |
      ((u8[i + 21] ?? 0) << 24);
    const nameLen = (u8[i + 26] ?? 0) | ((u8[i + 27] ?? 0) << 8);
    const extraLen = (u8[i + 28] ?? 0) | ((u8[i + 29] ?? 0) << 8);
    const nameStart = i + 30;
    const thisName = Buffer.from(u8.slice(nameStart, nameStart + nameLen)).toString('utf8');
    if (thisName === 'word/document.xml') {
      const dataStart = nameStart + nameLen + extraLen;
      const raw = u8.slice(dataStart, dataStart + compSize);
      return method === 0
        ? Buffer.from(raw).toString('utf8')
        : inflateRawSync(raw).toString('utf8');
    }
    start = nameStart + nameLen + extraLen + (compSize > 0 ? compSize : 1);
  }
  throw new Error('word/document.xml not found in assembled docx');
}

describe('assembleDocx', () => {
  let buffer: Buffer;
  let xml: string;

  beforeAll(async () => {
    buffer = await assembleDocx(lp, baseFields);
    const doc = (globalThis as { __lastDocxDocument?: unknown }).__lastDocxDocument;
    if (!doc) throw new Error('assembler did not expose __lastDocxDocument');
    xml = await packXml(doc);
  });

  it('produces a non-empty Buffer starting with the PK zip signature', () => {
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('renders header, sessions, reflections note and declaration in the document XML', async () => {
    expect(xml).toContain('Understanding developmental stages');
    expect(xml).toContain('Session 1');
    expect(xml).toContain('Session 2');
    expect(xml).toContain('Life and Career Skills');
    // Reflections row: exactly one fill-note per session (2 sessions)
    const noteCount = xml.split(TEACHER_FILL_NOTE).length - 1;
    expect(noteCount).toBe(2);
    // Declaration uses the system template with actual model/provider
    expect(xml).toContain('test-model via nim');
    expect(xml).toContain('DO 3 s.2026 Annex A');
    // Numbered references: bowReference first
    expect(xml).toContain('1. Official DepEd Three-Term Budget of Work Week 1-2');
    expect(xml).toContain('2. https://example.com/quexbook');
    // Letterhead lines rendered (allCaps → <w:caps/> display, original text casing)
    expect(xml).toContain('Republic of the Philippines');
    expect(xml).toContain('<w:caps/>');
    // Signature block names + roles
    expect(xml).toContain('Janice P. Enriquez');
    expect(xml).toContain('Head Teacher III');
    // Banner intro verbatim fragment
    expect(xml).toContain('Meaningful learning experiences are anchored');
  });

  it('renders fill blanks when teacher/section names are null', async () => {
    await assembleDocx(lp, {
      ...baseFields,
      teacherName: null,
      sectionLabel: null,
      preparedBy: null,
      checkedBy: null,
      notedBy: null,
      letterhead: null,
    });
    const doc = (globalThis as { __lastDocxDocument?: unknown }).__lastDocxDocument;
    if (!doc) throw new Error('assembler did not expose __lastDocxDocument');
    const anonXml = await packXml(doc);
    expect(anonXml).toContain(TEACHER_FILL_BLANK);
    expect(anonXml).not.toContain('Republic of the Philippines');
  });

  it('renders the shared competency cell exactly once (merged across sessions)', () => {
    const competency = 'Examine developmental stages and tasks.';
    const count = xml.split(competency).length - 1;
    expect(count).toBe(1);
    // All 9 rubric rows present
    expect(xml).toContain('RUBRIC FOR LESSON PLANNING SELF-CHECK AND/OR PEER COACHING');
    expect(xml).toContain('Intentions are clearly stated');
    expect(xml).toContain('Assessment strategies generate evidence if learning is successful.');
    expect(xml).toContain('Notes for my instructional coaching session:');
  });
});
