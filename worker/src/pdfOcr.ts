// worker/src/pdfOcr.ts
import { createCanvas } from "@napi-rs/canvas";

type PngPage = { page: number; png: Buffer };

export async function renderPdfToPngPages(buf: Buffer, maxPages = 3): Promise<PngPage[]> {
  // Use dynamic import so it works in TS + Node setups without fighting ESM/CJS
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    // These keep pdfjs calmer in Node
    disableFontFace: true,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const total = Math.min(pdf.numPages || 0, maxPages);

  const out: PngPage[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);

    // Start with scale=1 and then cap max dimension so we don’t send huge images
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDim = 1300; // keep OCR images reasonably sized
    const scale = Math.min(2, maxDim / Math.max(baseViewport.width, baseViewport.height));

    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    await page.render({
      canvasContext: ctx as any,
      viewport,
    }).promise;

    const png = canvas.toBuffer("image/png");
    out.push({ page: i, png });
  }

  return out;
}