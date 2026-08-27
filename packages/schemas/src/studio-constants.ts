/**
 * Shared studio output-assembly constants
 * (docs/specs/2026-08-17-lesson-output-assembly-design.md §2).
 *
 * Used when rendering teacher-completed-later fields in generated documents.
 * PPTX uses TEACHER_FILL_BLANK for null teacherName/sectionLabel on the title
 * slide; the DOCX generator also consumes TEACHER_FILL_NOTE for reflections.
 */
export const TEACHER_FILL_BLANK = '＿＿＿＿＿＿＿＿＿＿＿＿＿＿';
export const TEACHER_FILL_NOTE = '[To be completed by the teacher after the session]';
