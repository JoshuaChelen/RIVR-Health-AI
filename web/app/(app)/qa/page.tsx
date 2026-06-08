"use client";
import { useState } from "react";

import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/api";

interface Answer {
  answer: string;
  sources: { title: string; type: string }[];
}

export default function QAPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      setAnswer(await api.post<Answer>("/api/qa", { question }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <form onSubmit={ask} className="space-y-3">
          <h2 className="font-semibold">Ask about your health records</h2>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What medications am I on?" maxLength={500} required />
          <Button type="submit" disabled={busy || !question.trim()}>{busy ? "Thinking…" : "Ask"}</Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </Card>
      {answer && (
        <Card>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-sub">{answer.answer}</p>
          {!!answer.sources?.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {answer.sources.map((src, i) => (
                <span key={i} className="rounded-full bg-teal-soft px-2.5 py-1 text-xs text-teal">{src.title}</span>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
