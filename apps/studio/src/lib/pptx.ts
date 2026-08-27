import type { SlideDeckSpec } from '@eduksource/schemas/slide-deck.js';
import { TEACHER_FILL_BLANK } from '@eduksource/schemas/studio-constants.js';
import PptxGenJSImport from 'pptxgenjs';

// Minimal structural types for what this assembler uses from pptxgenjs.
// Needed because pptxgenjs@4.0.1's bundled d.ts loses its construct signature
// under TS6 strict/nodenext (TS2351 "This expression is not constructable");
// casting through these interfaces keeps everything strictly typed with no
// `any`, while the underlying instances are the real pptxgenjs objects.
interface PptxSlide {
  addText(text: string, options?: TextOptions): unknown;
  addNotes(text: string): unknown;
}
interface PptxPresentation {
  layout: string;
  addSlide(): PptxSlide;
  write(options: { outputType: string }): Promise<Buffer | string | ArrayBuffer | Blob | Uint8Array>;
}
const PptxGenJS = PptxGenJSImport as unknown as new () => PptxPresentation;

export type SystemFields = {
  teacherName: string | null;
  sectionLabel: string | null;
  gradeLevel: string;
  learningArea: string;
  generationMetadata: {
    provider: string;
    model: string;
    generatedAt: string;
  };
  bowReference: string;
};

// Palette (no '#' prefix — pptxgenjs rejects it; assembly spec §5.4)
const COLOR_TEXT = '1A1A1A';
const COLOR_ACCENT = '27548A'; // muted educational blue; revisit branding in Phase 2 visual polish
const COLOR_MUTED = '6B7280';

const PAGE_W = 13.33; // LAYOUT_WIDE inches
const PAGE_H = 7.5;

type TextOptions = Record<string, unknown>;

function addBulletedList(slide: PptxSlide, bullets: string[], yStart: number): void {
  let y = yStart;
  for (const bullet of bullets) {
    // Fresh options object per add* call — pptxgenjs mutates them (spec §5.4).
    slide.addText(bullet, {
      x: 1.0,
      y,
      w: PAGE_W - 2.0,
      h: 0.75,
      fontSize: 18,
      color: COLOR_TEXT,
      bullet: true,
      breakLine: true,
    });
    y += 0.85;
  }
}

export async function assemblePptx(deck: SlideDeckSpec, fields: SystemFields): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const session = deck.sessions[0];
  if (!session) throw new Error('SlideDeckSpec must contain exactly one session');

  for (const slideSpec of session.slides) {
    const slide = pres.addSlide();

    switch (slideSpec.layout) {
      case 'title': {
        slide.addText(deck.title, {
          x: 1.0,
          y: 2.4,
          w: PAGE_W - 2.0,
          h: 1.2,
          align: 'center',
          fontSize: 32,
          bold: true,
          color: COLOR_ACCENT,
        });
        slide.addText(
          `${fields.learningArea} · ${fields.gradeLevel}${fields.sectionLabel ? ` · ${fields.sectionLabel}` : ''}`,
          {
            x: 1.0,
            y: 3.7,
            w: PAGE_W - 2.0,
            h: 0.6,
            align: 'center',
            fontSize: 16,
            color: COLOR_MUTED,
          },
        );
        slide.addText(fields.teacherName ?? TEACHER_FILL_BLANK, {
          x: 1.0,
          y: 4.4,
          w: PAGE_W - 2.0,
          h: 0.6,
          align: 'center',
          fontSize: 14,
          italic: true,
          color: COLOR_TEXT,
        });
        slide.addText(fields.bowReference, {
          x: 1.0,
          y: PAGE_H - 0.9,
          w: PAGE_W - 2.0,
          h: 0.5,
          align: 'center',
          fontSize: 11,
          color: COLOR_MUTED,
        });
        break;
      }
      case 'objectives':
      case 'motivation':
      case 'activity': {
        slide.addText(slideSpec.heading, {
          x: 1.0,
          y: 0.8,
          w: PAGE_W - 2.0,
          h: 0.9,
          fontSize: 24,
          bold: true,
          color: COLOR_ACCENT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 2.0);
        break;
      }
      case 'checkForUnderstanding': {
        slide.addText(slideSpec.heading, {
          x: 1.0,
          y: 0.8,
          w: PAGE_W - 2.0,
          h: 0.9,
          fontSize: 24,
          bold: true,
          color: COLOR_ACCENT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 2.2);
        break;
      }
      case 'closing': {
        slide.addText(slideSpec.heading, {
          x: 1.0,
          y: 2.2,
          w: PAGE_W - 2.0,
          h: 0.9,
          align: 'center',
          fontSize: 26,
          bold: true,
          color: COLOR_ACCENT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 3.3);
        break;
      }
      case 'content':
      default: {
        slide.addText(slideSpec.heading, {
          x: 1.0,
          y: 0.8,
          w: PAGE_W - 2.0,
          h: 0.9,
          fontSize: 22,
          bold: true,
          color: COLOR_TEXT,
        });
        if (slideSpec.bullets) addBulletedList(slide, slideSpec.bullets, 2.0);
        break;
      }
    }

    if (slideSpec.speakerNotes) {
      slide.addNotes(slideSpec.speakerNotes);
    }
    // TODO(Phase 2): imagePrompt is populated but the assembler renders whitespace
    // where images will go; wire the image adapter (registry TaskType 'image')
    // and drop-in render here without regenerating decks.
  }

  // Documented test hook — exposes the assembled presentation for introspection.
  (globalThis as { __lastPptxPresentation?: unknown }).__lastPptxPresentation = pres;

  const out = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}

export async function assemblePptxToBase64(deck: SlideDeckSpec, fields: SystemFields): Promise<string> {
  return (await assemblePptx(deck, fields)).toString('base64');
}
