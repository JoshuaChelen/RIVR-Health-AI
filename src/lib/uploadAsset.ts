/**
 * Build a value suitable for `FormData.append("file", ...)` from a picked asset
 * on **web**.
 *
 * Browser `FormData` only accepts `Blob`/`File`/string. Appending the React
 * Native `{ uri, name, type }` object stringifies it to `"[object Object]"`, so
 * no file part reaches the server and DRF returns `400 "No file provided."`.
 *
 * On web, expo-document-picker / expo-image-picker assets expose a real `File`
 * on `asset.file`; when it is absent we fetch the `blob:`/`data:` `uri` into a
 * `Blob`. Native networking handles the `{ uri, name, type }` object directly,
 * so this helper is web-only — callers keep the plain object on native.
 */
export type PickedAsset = { uri: string; file?: Blob | File | null };

export async function toWebUploadFile(
  asset: PickedAsset,
  name: string,
  type: string,
): Promise<File> {
  const existing = asset.file;
  if (existing) {
    return existing instanceof File ? existing : new File([existing], name, { type });
  }
  const res = await fetch(asset.uri);
  if (!res.ok) throw new Error(`Failed to read picked file (${res.status})`);
  const blob = await res.blob();
  return new File([blob], name, { type });
}
