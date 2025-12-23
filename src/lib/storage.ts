// src/lib/storage.ts
import { supabase } from "./supabase";

/**
 * Normalizes folder names so:
 *   "extracted-fhir", "extracted_fhir", "extracted fhir"
 * all compare as the same.
 */
function normalizeFolderName(name: string) {
  return name.trim().toLowerCase().replace(/[-_\s]+/g, "");
}

async function objectExists(bucket: string, path: string) {
  // path should look like "folder/file.json" or "a/b/file.json"
  const parts = path.split("/");
  if (parts.length < 2) return false;

  const prefix = parts.slice(0, -1).join("/");
  const filename = parts[parts.length - 1];

  const { data, error } = await supabase.storage.from(bucket).list(prefix);
  if (error) return false;

  return (data ?? []).some((x) => x.name === filename);
}

/**
 * If the first folder segment is wrong (dash/space/etc),
 * find the actual top-level folder in the bucket and swap it in.
 */
async function fixTopLevelFolderIfNeeded(bucket: string, path: string) {
  const parts = path.split("/");
  if (parts.length < 2) return path;

  const requestedTop = parts[0];
  const requestedNorm = normalizeFolderName(requestedTop);

  const { data: root, error } = await supabase.storage.from(bucket).list("");
  if (error || !root) return path;

  const match = root.find((x) => normalizeFolderName(x.name) === requestedNorm);
  if (!match) return path;

  // Swap top-level folder
  parts[0] = match.name;
  return parts.join("/");
}

/**
 * Creates a signed URL for a storage object.
 * If not found, tries to auto-correct the top-level folder name.
 */
export async function createSignedFileUrl(path: string, expiresInSeconds = 60 * 10) {
  const bucket = "documents";

  // Try as-is first
  {
    const exists = await objectExists(bucket, path);
    if (exists) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
      if (error) throw error;
      return data.signedUrl;
    }
  }

  // Try auto-fixing top-level folder
  const fixed = await fixTopLevelFolderIfNeeded(bucket, path);

  if (fixed !== path) {
    const exists = await objectExists(bucket, fixed);
    if (exists) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(fixed, expiresInSeconds);
      if (error) throw error;
      return data.signedUrl;
    }
  }

  // If still not found, give a clear error
  throw new Error(
    `Object not found in bucket "${bucket}". Tried "${path}"` +
      (fixed !== path ? ` and "${fixed}"` : "") +
      `. Check the file’s folder/name in Storage vs the DB path.`
  );
}
