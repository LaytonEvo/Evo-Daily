"use client";

import { useState } from "react";
import { Check, Clipboard } from "lucide-react";

/** Copies a prepared block of text — used for "Copy for Claude Code". */
export function CopyButton({ text, label = "Copy for Claude Code" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked: nothing useful to say beyond the button not changing.
        }
      }}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
