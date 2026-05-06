"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SearchInput({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce navigation
  const handleChange = (v: string) => {
    setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (v.trim()) {
        router.push(`/search?q=${encodeURIComponent(v.trim())}`);
      } else {
        router.push("/search");
      }
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="search"
      value={value}
      autoFocus
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Search clients, plans, supplements, symptoms…"
      className="w-full rounded-lg border px-4 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  );
}

/** Keyboard shortcut listener — renders nothing, just wires cmd/ctrl+K → /search */
export function SearchShortcut() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [router, searchParams]);

  return null;
}
