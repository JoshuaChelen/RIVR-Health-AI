import { describe, expect, test, vi } from "vitest";

vi.mock("./api/data", () => ({ askHealthQuestion: vi.fn() }));

import { askHealthQuestion as apiAsk } from "./api/data";
import { askHealthQuestion } from "./aiQuestionSearch";

describe("AI question search client", () => {
  test("returns idle for blank questions without calling the API", async () => {
    const result = await askHealthQuestion("   ");
    expect(result).toEqual({ status: "idle" });
    expect(apiAsk).not.toHaveBeenCalled();
  });

  test("returns the answer and normalized sources on success", async () => {
    (apiAsk as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Your records mention ibuprofen after knee surgery.",
      sources: [{ title: "Knee surgery record", type: "document" }, { name: "Lab panel" }, { nope: 1 }],
    });
    const result = await askHealthQuestion("What meds after knee surgery?");
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.answer).toContain("ibuprofen");
      expect(result.sources.map((s) => s.title)).toEqual(["Knee surgery record", "Lab panel"]);
    }
  });

  test("returns unavailable when the API throws", async () => {
    (apiAsk as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    const result = await askHealthQuestion("anything");
    expect(result.status).toBe("unavailable");
  });
});
