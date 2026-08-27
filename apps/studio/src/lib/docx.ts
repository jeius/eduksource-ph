import type {
  LessonPlanResponse,
} from '@eduksource/schemas/lesson-plan.js';
import type { SystemFields } from '@eduksource/schemas/system-fields.js';
import {
  TEACHER_FILL_BLANK,
  TEACHER_FILL_NOTE,
} from '@eduksource/schemas/studio-constants.js';
import {
  AlignmentType,
  Document,
  type ISectionOptions,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/**
 * DOCX assembly — formal DepEd-style DLL document (assembly spec §4).
 * Pure deterministic code over LessonPlanResponse + SystemFields; zero AI calls.
 * Binding rules (§4.5): A4, DXA widths on tables AND every cell (never
 * percentage), banner shading CLEAR + D9D9D9 (never SOLID), every line its own
 * Paragraph (never \n), PageBreak inside a Paragraph.
 */

// A4 in twips (DXA): 11906 x 16838. Margins 1440 (1") each side.
const PAGE_WIDTH = 11_906;
const MARGIN = 1_440;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2; // 9026
const LABEL_COL_WIDTH = 2_200;
const HEADER_COL_WIDTH = TABLE_WIDTH - LABEL_COL_WIDTH;

function sessionColWidth(n: number): number {
  return Math.floor((TABLE_WIDTH - LABEL_COL_WIDTH) / n);
}

/** Section banner intro texts — verbatim from LP_Template_for_Orientations.pdf P2-P4. */
export const BANNER_INTROS = {
  Intentions:
    'Meaningful learning experiences are anchored in how we frame them. Start by deciding what you want learners to master by the end of the lesson – keep it clear and simple. Remember: Understanding your learners’ evolving context and designing around it ensure that your lessons connect with and are relevant to them.',
  'Learning Experience':
    'A learning experience is like a thoughtfully designed journey. Each activity and interaction builds towards meaningful understanding and growth. Identify activities and interactions to help learners gain knowledge, skills, or understanding in a purposeful way.',
  Assessment:
    'Create a task, activity or questions to evaluate learning and provide feedback every now and then. Include ways for learners to ask for guidance or support throughout each session. Remember to provide appropriate accommodations so all learners can demonstrate their understanding (e.g., varied response formats, small group options, visual or auditory supports).',
  'Ways Forward':
    'Meaningful learning can also happen beyond the classroom – for both the learners and the teacher. Pause and reflect on what happened today.',
} as const;

const DECLARATION_TEMPLATE =
  'AI tools ({model} via {provider}) were used to assist in organizing lesson components and formatting this lesson plan based on curriculum standards, following DO 3 s.2026 Annex A. All content was reviewed, contextualized, and validated by the facilitator prior to use.';

export function declarationText(fields: SystemFields): string {
  return DECLARATION_TEMPLATE.replaceAll('{model}', fields.generationMetadata.model).replaceAll(
    '{provider}',
    fields.generationMetadata.provider
  );
}

// 9 self-check rows — verbatim from LP_Template_for_Orientations.pdf P5.
const RUBRIC_ROWS = [
  'Intentions are clearly stated, with appropriate learning competencies articulated.',
  'Intentions are evident across all sections, there is coherence.',
  'Learning experience is clear – another teacher can implement this lesson without additional explanation.',
  'Learning experience is well-designed, with intentionally embedded Learning Design Principles.',
  'Learning experience maximizes available opportunities for integration.',
  'Learning experience is inclusive, provides opportunities to support learners with disabilities, barriers, and unique contexts.',
  'Assessment strategies are integrated throughout the session to see learners’ progress or if they need support.',
  'Assessment strategies generate evidence if learning is successful.',
  'The following interventions are actionable, providing ways to extend or adjust learning based on reflections.',
] as const;

function cellParagraphs(lines: string[], bold = false): Paragraph[] {
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, bold })],
      })
  );
}

function labelCell(text: string, rowHeightHint: number): TableCell {
  return new TableCell({
    width: { size: LABEL_COL_WIDTH, type: WidthType.DXA },
    children: [
      new Paragraph({ children: [new TextRun({ text, bold: true })] }),
    ],
    margins: { top: rowHeightHint, bottom: rowHeightHint },
  });
}

function bannerRow(label: keyof typeof BANNER_INTROS): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 2,
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'D9D9D9' },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: `${label}. `, italics: true, bold: true }),
            ],
          }),
          new Paragraph({
            children: [new TextRun({ text: BANNER_INTROS[label], italics: true })],
          }),
        ],
      }),
    ],
  });
}

export function buildRubricPage(): (Paragraph | Table)[] {
  const rubricColWidths = [
    Math.floor(TABLE_WIDTH * 0.55),
    Math.floor(TABLE_WIDTH * 0.15),
    Math.floor(TABLE_WIDTH * 0.15),
    Math.floor(TABLE_WIDTH * 0.15),
  ];
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: 'RUBRIC FOR LESSON PLANNING SELF-CHECK AND/OR PEER COACHING',
          bold: true,
        }),
      ],
    }),
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA },
      columnWidths: rubricColWidths,
      rows: [
        new TableRow({
          children: ['I can say that in my lesson plan…', 'Yes', 'Not Yet', 'Why?/ What will make it better?'].map(
            (h, i) =>
              new TableCell({
                width: { size: rubricColWidths[i] as number, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: 'D9D9D9' },
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
              })
          ),
        }),
        ...RUBRIC_ROWS.map(
          (row) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: rubricColWidths[0] as number, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: row })] })],
                }),
                ...[1, 2, 3].map(
                  (i) =>
                    new TableCell({
                      width: { size: rubricColWidths[i] as number, type: WidthType.DXA },
                      children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
                    })
                ),
              ],
            })
        ),
      ],
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Notes for my instructional coaching session:' })],
    }),
  ];
}

function headerTable(lp: LessonPlanResponse, fields: SystemFields): Table {
  const rows: Array<[string, Paragraph[]]> = [
    ['Lesson Title', cellParagraphs([lp.meta.lessonTitle])],
    ['Learning Area/s', cellParagraphs([fields.learningArea])],
    [
      'Name of Teacher/s',
      cellParagraphs([fields.teacherName ?? TEACHER_FILL_BLANK]),
    ],
    [
      'Grade Level and Section',
      cellParagraphs([
        `${fields.gradeLevel} ${fields.sectionLabel ?? TEACHER_FILL_BLANK}`,
      ]),
    ],
    ['No. of Sessions', cellParagraphs([String(lp.meta.numberOfSessions)])],
    [
      'References\n(books, websites, toolkits, etc.)'.split('\n')[0] as string,
      [
        new Paragraph({
          children: [
            new TextRun({ text: `1. ${fields.bowReference}`, bold: true }),
          ],
        }),
        ...lp.meta.referencesFromBow.map(
          (ref, i) =>
            new Paragraph({
              children: [new TextRun({ text: `${i + 2}. ${ref}` })],
            })
        ),
      ],
    ],
    ['Declaration of AI use', cellParagraphs([declarationText(fields)])],
  ];

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [LABEL_COL_WIDTH, HEADER_COL_WIDTH],
    rows: rows.map(
      ([label, valueParas]) =>
        new TableRow({
          children: [
            labelCell(label, 60),
            new TableCell({
              width: { size: HEADER_COL_WIDTH, type: WidthType.DXA },
              children: valueParas,
            }),
          ],
        })
    ),
  });
}

function sessionBodyCell(paras: Paragraph[], width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: paras,
  });
}

function bodyTable(lp: LessonPlanResponse): Table {
  const n = lp.meta.numberOfSessions;
  const col = sessionColWidth(n);
  const intentionsSessions = lp.intentions.sessions;
  const experienceSessions = lp.learningExperience.sessions;
  const assessmentSessions = lp.assessment.sessions;
  const waysForwardSessions = lp.waysForward.sessions;

  const competency = lp.intentions.learningCompetencyAndStandards;
  const competencyParas: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: 'Content Standard:', bold: true })],
    }),
    ...competency.contentStandard.map(
      (cs) => new Paragraph({ children: [new TextRun({ text: cs })] })
    ),
    new Paragraph({
      children: [new TextRun({ text: 'Performance Standard:', bold: true })],
    }),
    ...competency.performanceStandard.map(
      (ps) => new Paragraph({ children: [new TextRun({ text: ps })] })
    ),
    new Paragraph({
      children: [new TextRun({ text: 'Learning Competency:', bold: true })],
    }),
    new Paragraph({ children: [new TextRun({ text: competency.learningCompetency })] }),
  ];

  const perSessionRow = (
    label: string,
    pick: (i: number) => string[] | Paragraph[]
  ): TableRow =>
    new TableRow({
      children: [
        labelCell(label, 60),
        ...intentionsSessions.map((s, i) => {
          const at = intentionsSessions.findIndex((x) => x.sessionLabel === s.sessionLabel);
          void at;
          const idx = experienceSessions.findIndex((x) => x.sessionLabel === s.sessionLabel);
          void idx;
          const value = pick(i);
          return sessionBodyCell(
            value.every((v) => typeof v === 'string')
              ? cellParagraphs(value as string[])
              : (value as Paragraph[]),
            col
          );
        }),
      ],
    });

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [LABEL_COL_WIDTH, ...Array.from({ length: n }, () => col)],
    rows: [
      bannerRow('Intentions'),
      // Session header row: one column per session (matches the DLL header layout).
      new TableRow({
        children: [
          labelCell('Session', 60),
          ...intentionsSessions.map(
            (s) =>
              sessionBodyCell(
                [new Paragraph({ children: [new TextRun({ text: s.sessionLabel, bold: true })] })],
                col
              )
          ),
        ],
      }),
      new TableRow({
        children: [
          labelCell('Learning Competency and Curriculum Standards', 60),
          new TableCell({
            columnSpan: n,
            width: { size: col * n, type: WidthType.DXA },
            children: competencyParas,
          }),
        ],
      }),
      perSessionRow('Learning Objectives', (i) => intentionsSessions[i]?.learningObjectives ?? []),
      perSessionRow('Learner Context', (i) => [intentionsSessions[i]?.learnerContext ?? '']),
      bannerRow('Learning Experience'),
      perSessionRow('Pre-Lesson', (i) => [experienceSessions[i]?.preLesson ?? '']),
      perSessionRow('Flow', (i) => [experienceSessions[i]?.flow ?? '']),
      perSessionRow('Learning Resources', (i) => experienceSessions[i]?.learningResources ?? []),
      perSessionRow('Opportunities for integration', (i) => [
        experienceSessions[i]?.opportunitiesForIntegration ?? '',
      ]),
      bannerRow('Assessment'),
      perSessionRow('Formative Assessment', (i) => [assessmentSessions[i]?.formativeAssessment ?? '']),
      bannerRow('Ways Forward'),
      perSessionRow('Extended learning opportunities', (i) => [
        waysForwardSessions[i]?.extendedLearningOpportunities ?? '',
      ]),
      perSessionRow('Reflections', () => [TEACHER_FILL_NOTE]),
    ],
  });
}

function signatureTable(fields: SystemFields): Table {
  const col = Math.floor(TABLE_WIDTH / 3);
  const cols: Array<{ name: string; label: string; role?: string }> = [
    { name: fields.preparedBy ?? fields.teacherName ?? TEACHER_FILL_BLANK, label: 'Prepared by:' },
    { name: fields.checkedBy ?? TEACHER_FILL_BLANK, label: 'Checked by:', role: fields.checkedByRole },
    { name: fields.notedBy ?? TEACHER_FILL_BLANK, label: 'Noted:', role: fields.notedByRole },
  ];
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [col, col, TABLE_WIDTH - col * 2],
    rows: [
      new TableRow({
        children: cols.map(
          (c) =>
            new TableCell({
              width: { size: col, type: WidthType.DXA },
              children: [
                new Paragraph({ children: [new TextRun({ text: c.label })] }),
                new Paragraph({ children: [new TextRun({ text: ' ' })] }),
                new Paragraph({ children: [new TextRun({ text: c.name, bold: true })] }),
                ...(c.role
                  ? [new Paragraph({ children: [new TextRun({ text: c.role })] })]
                  : []),
              ],
            })
        ),
      }),
    ],
  });
}

export async function assembleDocx(
  lp: LessonPlanResponse,
  fields: SystemFields
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  if (fields.letterhead?.lines?.length) {
    for (const line of fields.letterhead.lines) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: line, allCaps: true })],
        })
      );
    }
  }

  children.push(headerTable(lp, fields));
  children.push(new Paragraph({ children: [new TextRun({ text: ' ' })] }));
  children.push(bodyTable(lp));
  children.push(new Paragraph({ children: [new TextRun({ text: ' ' })] }));
  children.push(signatureTable(fields));
  children.push(
    new Paragraph({ children: [new PageBreak()] })
  );
  children.push(...buildRubricPage());

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: 16_838 },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children: children as ISectionOptions['children'],
      },
    ],
  });

  (globalThis as { __lastDocxDocument?: unknown }).__lastDocxDocument = doc;

  return Buffer.from(await Packer.toBuffer(doc));
}
