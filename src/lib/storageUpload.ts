// src/lib/storageUpload.ts
import { File } from "expo-file-system";
import { supabase } from "./supabase";

export async function uploadUriToStorage(opts: {
  bucket: string;
  storagePath: string;
  uri: string;
  contentType: string;
  upsert?: boolean;
}) {
  // Same strategy you already use in UploadFile.tsx
  const res = await fetch(opts.uri);
  if (!res.ok) {
    throw new Error(`Failed to read local file (${res.status})`);
  }

  const ab = await res.arrayBuffer();

  const { error } = await supabase.storage.from(opts.bucket).upload(opts.storagePath, ab, {
    contentType: opts.contentType,
    upsert: !!opts.upsert,
  });

  if (error) throw error;

  return { sizeBytes: ab.byteLength };
}