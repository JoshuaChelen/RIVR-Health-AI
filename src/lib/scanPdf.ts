/**
 * Native stub — Metro resolves this file on iOS and Android.
 * PDF compilation on native uses expo-print (HTML → PDF), not this module.
 * This stub exists so UploadFile.tsx can import compileScanPagesForWeb
 * unconditionally without Metro complaining about a missing module on native.
 */
export type ScanPageInput = { uri: string; mimeType: string };

export async function compileScanPagesForWeb(
  _pages: ScanPageInput[]
): Promise<Uint8Array> {
  throw new Error(
    "compileScanPagesForWeb is only available on web. Use expo-print on native."
  );
}
