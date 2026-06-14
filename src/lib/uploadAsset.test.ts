import { afterEach, describe, expect, it, vi } from "vitest";

import { toWebUploadFile } from "./uploadAsset";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toWebUploadFile", () => {
  it("returns the asset's existing File unchanged", async () => {
    const real = new File(["%PDF-1.4"], "real.pdf", { type: "application/pdf" });
    const out = await toWebUploadFile(
      { uri: "blob:x", file: real },
      "ignored.pdf",
      "application/pdf",
    );
    expect(out).toBe(real);
    expect(out).toBeInstanceOf(File);
  });

  it("wraps a Blob asset in a File with the given name and type", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const out = await toWebUploadFile(
      { uri: "blob:x", file: blob },
      "doc.pdf",
      "application/pdf",
    );
    expect(out).toBeInstanceOf(File);
    expect(out.name).toBe("doc.pdf");
    expect(out.type).toBe("application/pdf");
  });

  // The actual bug: with no File on the asset, the old code appended the bare
  // { uri, name, type } object, which the browser dropped. We must produce a
  // real File so the multipart "file" part survives.
  it("fetches the uri into a real File when the asset has no file", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);

    const out = await toWebUploadFile({ uri: "blob:abc" }, "scan.pdf", "application/pdf");

    expect(fetchMock).toHaveBeenCalledWith("blob:abc");
    expect(out).toBeInstanceOf(File);
    expect(out.name).toBe("scan.pdf");
    expect(out.type).toBe("application/pdf");
  });

  it("throws when the uri cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      toWebUploadFile({ uri: "blob:bad" }, "x.pdf", "application/pdf"),
    ).rejects.toThrow(/404/);
  });
});
