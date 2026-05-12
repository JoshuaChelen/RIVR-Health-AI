import { describe, expect, it } from "vitest";

import { documentProcessingFooterCopy } from "./documentProcessingUi";

describe("document processing footer copy", () => {
  it("does not show nothing-to-process immediately after processing starts", () => {
    expect(
      documentProcessingFooterCopy({
        starting: false,
        pendingCount: 0,
        message: "Started processing 2 items.",
      }),
    ).toEqual({
      buttonLabel: "Processing started",
      disabled: true,
      hint: "Watch the Analyzing section above for progress.",
    });
  });

  it("shows the normal empty and pending states", () => {
    expect(
      documentProcessingFooterCopy({ starting: false, pendingCount: 0, message: null }),
    ).toEqual({
      buttonLabel: "Nothing to process",
      disabled: true,
      hint: "Upload files or save a change in Medical Profile, then tap Process.",
    });

    expect(
      documentProcessingFooterCopy({ starting: false, pendingCount: 3, message: null }),
    ).toEqual({
      buttonLabel: "Process 3 items",
      disabled: false,
      hint: "3 items ready. Tap Process to analyze.",
    });
  });
});
