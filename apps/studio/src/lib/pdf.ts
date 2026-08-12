import { definePDFJSModule, getDocumentProxy, extractText as unpdfExtractText } from 'unpdf'

// Initialize PDF.js once with legacy build for Node.js
await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))

export async function extractText(file: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(file)
  const { text, totalPages } = await unpdfExtractText(pdf, {
    mergePages: true,
  })
  return { text, pages: totalPages }
}
