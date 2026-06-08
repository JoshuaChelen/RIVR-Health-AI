"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import type { Document, Paginated } from "@/lib/types";

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await api.get<Paginated<Document>>("/api/documents/?limit=50");
    setDocs(data.results);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // poll processing status
    return () => clearInterval(t);
  }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", file.name);
      const guessed = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "voice_note" : "pdf";
      form.append("source_type", guessed);
      const doc = await api.upload<Document>("/api/documents/upload/", form);
      await api.post("/api/jobs/enqueue", { documentIds: [doc.id] });
      await load();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <Card className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Documents</h2>
          <p className="text-sm text-muted">Upload PDFs, images, or voice notes to extract health facts.</p>
        </div>
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</Button>
        <input ref={fileRef} type="file" hidden onChange={onUpload} accept=".pdf,image/*,audio/*" />
      </Card>

      {docs.length === 0 ? (
        <p className="text-sm text-muted">No documents yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <Card key={d.id} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium text-ink">{d.title || "Untitled"}</div>
                <div className="text-xs text-muted">{new Date(d.created_at).toLocaleDateString()}</div>
              </div>
              <StatusBadge status={d.status} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    uploaded: "bg-slate-100 text-slate-600",
    processing: "bg-amber-100 text-amber-700",
    processed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[status] ?? map.uploaded}`}>{status}</span>;
}
