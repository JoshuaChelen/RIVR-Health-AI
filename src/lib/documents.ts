import { supabase } from "./supabase";

export function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

export async function insertDocumentRow(params: {
  userId: string;
  title: string;
  storagePath: string;      // can be PDF or audio, we store it in pdf_path for now
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        user_id: params.userId,
        title: params.title,

        // NOTE: we reuse pdf_path to store the original file path (PDF or audio)
        pdf_path: params.storagePath,

        status: "uploaded",
        mime_type: params.mimeType ?? "application/octet-stream",
        size_bytes: typeof params.sizeBytes === "number" ? params.sizeBytes : null,

        processing_error: null,
        processed_at: null,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data as { id: string };
}