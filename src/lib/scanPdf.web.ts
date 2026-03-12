/**
 * Web-only PDF compiler — Metro resolves this file instead of scanPdf.ts
 * when building for the web platform.
 *
 * Optimisation strategy (applied sequentially to avoid memory spikes):
 *
 * 1. Resize to MAX_SCAN_WIDTH (1800 px max, never upscale).
 *    A modern phone camera produces images 3000–8000 px wide; only ~1800 px
 *    are needed for comfortable screen and print readability of text documents.
 *    Cutting from 4000 px to 1800 px reduces pixel count by 6.25×, which
 *    proportionally reduces encoding time, pdf-lib embedding, and upload size.
 *
 * 2. JPEG at JPEG_QUALITY (0.82) instead of PNG.
 *    Canvas PNG output for a phone photo is typically 8–20 MB (lossless).
 *    JPEG at 0.82 is typically 200–600 KB for the same content while keeping
 *    all text in a medical document clearly legible.
 *    pdf-lib embeds JPEG bytes directly (no re-encode) which is also faster
 *    than embedding an image parsed from PNG.
 *
 * 3. canvas handles any browser-decodable format (JPEG, PNG, WebP, HEIC on
 *    Safari ≥17, etc.) so we never reject a valid image the user selected.
 */
import { PDFDocument } from "@cantoo/pdf-lib";

export type ScanPageInput = { uri: string; mimeType: string };

// ─── Tuneable constants ────────────────────────────────────────────────────────

const MAX_SCAN_WIDTH = 1800;
const JPEG_QUALITY   = 0.82;

// ─── Image encoding ───────────────────────────────────────────────────────────

/**
 * Loads an image URI into an HTMLImageElement, scales it down to at most
 * MAX_SCAN_WIDTH pixels wide (preserving aspect ratio; never upscales), draws
 * it onto a canvas, and returns the canvas output as JPEG bytes.
 *
 * The img and canvas elements are never appended to the DOM; they are
 * ephemeral and eligible for GC once the Promise resolves.
 */
function resizeAndEncodeAsJpeg(uri: string): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;

      if (srcW === 0 || srcH === 0) {
        reject(new Error("Image has zero dimensions — the file may be corrupt."));
        return;
      }

      // Scale down only; never upscale a small image.
      const scale = srcW > MAX_SCAN_WIDTH ? MAX_SCAN_WIDTH / srcW : 1;
      const w = Math.round(srcW * scale);
      const h = Math.round(srcH * scale);

      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context is unavailable in this browser."));
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to encode image as JPEG."));
            return;
          }
          blob
            .arrayBuffer()
            .then((ab) => resolve(new Uint8Array(ab)))
            .catch(reject);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () =>
      reject(new Error("Failed to load image. The file may be corrupt or unsupported."));

    // blob: URIs from expo-image-picker are same-origin; no CORS header needed.
    img.src = uri;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compiles an ordered array of image pages into a single PDF document.
 * Each page is resized (if wider than MAX_SCAN_WIDTH) and JPEG-encoded before
 * embedding. Pages are processed sequentially to avoid simultaneous large
 * allocations. The resulting Uint8Array is ready to upload directly.
 */
export async function compileScanPagesForWeb(
  pages: ScanPageInput[]
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("No pages provided to compile.");

  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    const jpegBytes = await resizeAndEncodeAsJpeg(page.uri);
    const image     = await pdfDoc.embedJpg(jpegBytes);
    const { width, height } = image;
    const pdfPage = pdfDoc.addPage([width, height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width, height });
  }

  return pdfDoc.save();
}
