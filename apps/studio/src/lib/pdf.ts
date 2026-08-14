import { Canvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { definePDFJSModule, getDocumentProxy, extractText as unpdfExtractText } from 'unpdf';

// Initialize PDF.js once with legacy build for Node.js
await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));

export async function extractText(file: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(file);
  const { text, totalPages } = await unpdfExtractText(pdf, {
    mergePages: true,
  });
  return { text, pages: totalPages };
}

export class TooManyPagesError extends Error {
  constructor(maxPages: number) {
    super(`Too many pages (max ${maxPages})`);
    this.name = 'TooManyPagesError';
  }
}

type PdfCanvasContext = CanvasRenderingContext2D;

export async function pdfPagesToPngs(file: Uint8Array, maxPages: number): Promise<string[]> {
  const doc = await getDocument({ data: file }).promise;
  try {
    const pageCount = doc.numPages;
    if (pageCount > maxPages) {
      throw new TooManyPagesError(maxPages);
    }

    const images: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = new Canvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({
        canvas: null,
        canvasContext: ctx as unknown as PdfCanvasContext,
        viewport,
      }).promise;
      images.push(canvas.toDataURL('image/png').split(',')[1] ?? '');
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return images;
  } finally {
    await doc.loadingTask.destroy();
  }
}
