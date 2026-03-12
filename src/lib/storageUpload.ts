// src/lib/storageUpload.ts
import { supabase } from "./supabase";

/**
 * Fetches a local URI (file:// on native, blob: on web) as an ArrayBuffer
 * and uploads it to Supabase Storage.
 */
export async function uploadUriToStorage(opts: {
  bucket: string;
  storagePath: string;
  uri: string;
  contentType: string;
  upsert?: boolean;
}) {
  const res = await fetch(opts.uri);
  if (!res.ok) {
    throw new Error(`Failed to read local file (${res.status})`);
  }

  const ab = await res.arrayBuffer();

  const { error } = await supabase.storage
    .from(opts.bucket)
    .upload(opts.storagePath, ab, {
      contentType: opts.contentType,
      upsert: !!opts.upsert,
    });

  if (error) throw error;

  return { sizeBytes: ab.byteLength };
}

/**
 * Uploads a Uint8Array directly to Supabase Storage — no URI or temp file
 * required. Used on web where PDF bytes are generated in-memory by pdf-lib.
 */
export async function uploadBytesToStorage(opts: {
  bucket: string;
  storagePath: string;
  bytes: Uint8Array;
  contentType: string;
  upsert?: boolean;
}) {
  const { error } = await supabase.storage
    .from(opts.bucket)
    .upload(opts.storagePath, opts.bytes, {
      contentType: opts.contentType,
      upsert: !!opts.upsert,
    });

  if (error) throw error;

  return { sizeBytes: opts.bytes.byteLength };
}