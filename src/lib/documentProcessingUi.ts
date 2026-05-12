type ProcessingFooterInput = {
  starting: boolean;
  pendingCount: number;
  message: string | null;
};

type ProcessingFooterCopy = {
  buttonLabel: string;
  disabled: boolean;
  hint: string | null;
};

export function documentProcessingFooterCopy({
  starting,
  pendingCount,
  message,
}: ProcessingFooterInput): ProcessingFooterCopy {
  if (starting) {
    return { buttonLabel: "Starting...", disabled: true, hint: null };
  }

  if (message?.startsWith("Started processing") && pendingCount === 0) {
    return {
      buttonLabel: "Processing started",
      disabled: true,
      hint: "Watch the Analyzing section above for progress.",
    };
  }

  if (pendingCount > 0) {
    return {
      buttonLabel: `Process ${pendingCount} item${pendingCount === 1 ? "" : "s"}`,
      disabled: false,
      hint: `${pendingCount} item${pendingCount === 1 ? "" : "s"} ready. Tap Process to analyze.`,
    };
  }

  return {
    buttonLabel: "Nothing to process",
    disabled: true,
    hint: "Upload files or save a change in Medical Profile, then tap Process.",
  };
}
