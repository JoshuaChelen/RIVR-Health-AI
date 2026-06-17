import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the HTTP client so we assert the exact routes the review wrappers call —
// trailing slashes matter (DRF @action routes have them; profile ai-items don't).
vi.mock("./client", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    del: vi.fn(() => Promise.resolve({})),
    upload: vi.fn(() => Promise.resolve({})),
  },
  ApiError: class ApiError {},
}));

import { api } from "./client";
import {
  getDocumentAnalysis, detachDocument, reprocessDocument, confirmAllDocument,
  confirmAiItem, rejectAiItem, editAiItem, getAiItemSources, unrejectAiItem,
} from "./data";

describe("review api wrappers hit the exact backend routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("document actions use trailing slashes", async () => {
    await getDocumentAnalysis("abc");
    expect(api.get).toHaveBeenCalledWith("/api/documents/abc/analysis/");
    await detachDocument("abc");
    expect(api.post).toHaveBeenCalledWith("/api/documents/abc/detach/");
    await reprocessDocument("abc");
    expect(api.post).toHaveBeenCalledWith("/api/documents/abc/reprocess/");
    await confirmAllDocument("abc");
    expect(api.post).toHaveBeenCalledWith("/api/documents/abc/confirm-all/");
  });

  it("ai-item actions use NO trailing slash and correct verbs", async () => {
    await confirmAiItem("ai_1");
    expect(api.post).toHaveBeenCalledWith("/api/profile/ai-items/ai_1/confirm");
    await rejectAiItem("ai_1");
    expect(api.post).toHaveBeenCalledWith("/api/profile/ai-items/ai_1/reject");
    await getAiItemSources("ai_1");
    expect(api.get).toHaveBeenCalledWith("/api/profile/ai-items/ai_1/sources");
    await editAiItem("ai_1", { dose: "1000mg" });
    expect(api.patch).toHaveBeenCalledWith("/api/profile/ai-items/ai_1", { dose: "1000mg" });
  });

  it("un-reject posts field + key to the static route", async () => {
    await unrejectAiItem("medications", "metformin");
    expect(api.post).toHaveBeenCalledWith(
      "/api/profile/ai-items/unreject", { field: "medications", key: "metformin" });
  });
});
