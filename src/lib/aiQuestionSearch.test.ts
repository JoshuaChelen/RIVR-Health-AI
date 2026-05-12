import { describe, expect, test, vi } from "vitest";

import { askHealthQuestion } from "./aiQuestionSearch";

describe("AI question search client", () => {
  test("does not call the AI endpoint for blank questions", async () => {
    const fetchImpl = vi.fn();

    const result = await askHealthQuestion("   ", {
      endpoint: "https://example.com/answer",
      accessToken: "token",
      fetchImpl,
    });

    expect(result).toEqual({ status: "idle" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("posts natural-language questions to the AI answer endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "Your records mention ibuprofen after knee surgery.",
        sources: [{ title: "Knee surgery record", type: "document" }],
      }),
    });

    const result = await askHealthQuestion("What medications was I taking after knee surgery?", {
      endpoint: "https://example.com/answer",
      accessToken: "token",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/answer", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: "What medications was I taking after knee surgery?",
      }),
    });
    expect(result).toEqual({
      status: "answered",
      answer: "Your records mention ibuprofen after knee surgery.",
      sources: [{ title: "Knee surgery record", type: "document" }],
    });
  });

  test("returns an unavailable result instead of local keyword answers when AI fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    const result = await askHealthQuestion("Find my left thumb injury", {
      endpoint: "https://example.com/answer",
      accessToken: "token",
      fetchImpl,
    });

    expect(result).toEqual({
      status: "unavailable",
      message: "AI search is unavailable right now. Try again after the AI worker is connected.",
    });
  });
});
