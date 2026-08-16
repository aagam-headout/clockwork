"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Search over the digests this account has accumulated.
 *
 * The query lives in the URL, not component state, so a result is a link
 * worth pasting to someone — e.g. "the run where churn first moved".
 */
export function DigestSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQuery);

  function submit(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next.trim()) query.set("q", next.trim());
    else query.delete("q");
    // Status and text search compound: leaving both on returns their
    // intersection, which reads as "no results" for no visible reason.
    query.delete("status");
    router.push(query.toString() ? `/runs?${query}` : "/runs");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="relative flex-1 sm:max-w-xs"
      role="search"
    >
      <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search digests…"
        aria-label="Search digests"
        className="input h-8 pl-8 text-[13px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            submit("");
          }}
          aria-label="Clear search"
          className="text-subtle hover:text-foreground absolute top-1/2 right-2 inline-flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}
