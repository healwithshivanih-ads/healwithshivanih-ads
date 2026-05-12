"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

// v1 legacy sidebar. Only rendered on routes that still use the root
// layout (catalogue, search, ingest, resources, mindmap, backlog,
// dashboard-legacy, /clients, /plans, /assess). The v2 surfaces use
// FmAppShell which has its own nav.
//
// Client-area entries point at /clients-v2 so even if a coach is on a
// v1 page she gets bumped into the v2 shell on next nav.
const CLIENT_NAV = [
  { href: "/dashboard-v2", label: "🏠 Dashboard" },
  { href: "/clients-v2",   label: "👥 Clients" },
];

const KB_NAV = [
  { href: "/catalogue", label: "Catalogue" },
  { href: "/catalogue/cleanup", label: "🧹 Cleanup" },
  { href: "/resources", label: "🧰 Resources" },
  { href: "/mindmap",   label: "🧭 Mind Map" },
  { href: "/backlog",   label: "📝 Backlog" },
  { href: "/ingest",    label: "⬆️ Ingest" },
];

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();

  // ⌘K → search
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [router]);

  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        FM Coach
      </div>

      {/* Search bar */}
      <Link
        href="/search"
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground border bg-muted/30 hover:bg-accent hover:text-accent-foreground transition-colors mb-2"
      >
        <span>🔍</span>
        <span className="flex-1 text-xs">Search…</span>
        <kbd className="text-[9px] border rounded px-1 py-0.5 bg-background font-mono opacity-60">⌘K</kbd>
      </Link>

      {CLIENT_NAV.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}

      {/* Divider */}
      <div className="my-2 border-t border-border" />

      {KB_NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
