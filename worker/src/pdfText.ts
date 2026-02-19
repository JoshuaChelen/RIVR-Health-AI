import pdfParse from "pdf-parse";

export async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buf);
    const text = (result.text || "").trim();
    return text;
  } catch (e: any) {
    return "";
  }
}

export function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[TRUNCATED]";
}

export function chunkText(text: string, chunkChars: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkChars));
    i += chunkChars;
  }
  return chunks;
}
