"use client";

/**
 * FmAppShell — the v2 chrome. Renders the gradient sidebar, sticky topbar,
 * and a scrollable main content area, with a ⌘K listener wired up for the
 * quick-actions / search palette.
 *
 * Used by every Phase 1+ v2 route (/dashboard-v2, /calendar, /messages,
 * /settings, /help). Each route picks its own `activeNavId` + `crumbs` and
 * renders its content as children.
 *
 * Renders as a fixed inset:0 z:100 overlay so the legacy root layout (which
 * still owns the old SidebarNav) stays untouched. Once Phase 5 ships, the
 * legacy layout can drop and this becomes the only shell.
 */
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { FmSidebarNav, type FmNavSection } from "./FmSidebarNav";
import { FmTopBar, type FmBreadcrumb } from "./FmTopBar";
import {
  FmFloatingActions,
  type FmFloatingActionItem,
} from "./FmFloatingActions";

/** Global quick-action defaults — used by routes that don't pass `quickActions`. */
const DEFAULT_QUICK_ACTIONS: FmFloatingActionItem[] = [
  {
    id: "new-client",
    icon: "👤",
    label: "New client",
    hint: "Intake form, fresh profile",
    href: "/clients-v2/new",
  },
  {
    id: "search",
    icon: "🔍",
    label: "Search catalogue + clients",
    hint: "⌘K · full-text",
    href: "/search",
  },
  {
    id: "ingest",
    icon: "⬆️",
    label: "Ingest a document",
    hint: "PDF / markdown / URL → catalogue",
    href: "/ingest",
  },
];

const NAV: FmNavSection[] = [
  {
    label: "Workspace",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "📊", href: "/dashboard-v2" },
      { id: "clients", label: "All clients", icon: "👥", href: "/clients-v2" },
      { id: "calendar", label: "Calendar", icon: "🗓️", href: "/calendar" },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "new-client", label: "New client", icon: "➕", href: "/clients-v2/new" },
      { id: "messages", label: "Messages", icon: "💬", href: "/messages" },
    ],
  },
  {
    label: "Knowledge base",
    items: [
      { id: "catalogue", label: "Catalogue", icon: "📖", href: "/catalogue" },
      { id: "resources", label: "Resources", icon: "📚", href: "/resources" },
      { id: "mindmap", label: "Mind maps", icon: "🧭", href: "/mindmap" },
      // Renamed 2026-05-13 — "Catalogue queue" is clearer than "Backlog" and
      // better signals the workflow (items waiting to be authored into the
      // catalogue from ingest / mindmap mining / coach observations).
      { id: "backlog", label: "Catalogue queue", icon: "📝", href: "/backlog" },
      { id: "ingest", label: "Ingest", icon: "⬆️", href: "/ingest" },
      { id: "recipes", label: "Recipe images", icon: "🍽", href: "/recipes" },
    ],
  },
  {
    label: "Settings",
    items: [
      { id: "settings", label: "Settings", icon: "⚙️", href: "/settings" },
      { id: "help", label: "Help", icon: "❔", href: "/help" },
    ],
  },
];

export interface FmAppShellProps {
  activeNavId: string;
  crumbs?: FmBreadcrumb[];
  /** Right-aligned slot in the topbar (next to the search button). */
  topbarRightSlot?: React.ReactNode;
  /**
   * Override the floating-action items. Pass page-specific actions
   * (e.g. "new quick note for this client", "send template"). If omitted,
   * a sensible global default set is shown. Pass `null` to hide the FAB.
   */
  quickActions?: FmFloatingActionItem[] | null;
  children: React.ReactNode;
}

export function FmAppShell({
  activeNavId,
  crumbs,
  topbarRightSlot,
  quickActions,
  children,
}: FmAppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, setKbarOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // ⌘K → existing /search route (Phase 5 replaces this with an inline palette
  // overlay; for now we just route there because /search already does the
  // full-text catalogue + client search).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setKbarOpen(true);
        router.push("/search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div
      className="fm-v2"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        zIndex: 100,
        display: "flex",
      }}
    >
      <FmSidebarNav
        sections={NAV}
        activeId={activeNavId}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        brand={{
          name: "shivani hari",
          eyebrow: "functional medicine",
          href: "/dashboard-v2",
        }}
        footer={
          <>
            <Link
              href="/"
              style={{ color: "rgba(255,255,255,0.7)", textDecoration: "underline" }}
            >
              ← Legacy UI
            </Link>
            <div style={{ marginTop: 6, fontSize: 11 }}>v2 preview · phase 1</div>
          </>
        }
      />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <FmTopBar
          crumbs={crumbs}
          rightSlot={topbarRightSlot}
          onSearchClick={() => router.push("/search")}
          onMenuClick={() => setNavOpen(true)}
          user={{ initials: "SH", name: "Shivani Hari" }}
        />
        <main
          style={{
            flex: 1,
            padding: "var(--fm-page-pad)",
            overflowY: "auto",
            overflowX: "clip",
          }}
        >
          <div
            style={{
              maxWidth: 1400,
              margin: "0 auto",
              width: "100%",
            }}
          >
            {children}
          </div>
        </main>
      </div>
      {/* Floating quick-action button — pinned bottom-right. Pages pass
          `quickActions={null}` to hide; otherwise pass a custom list, or
          rely on the global DEFAULT_QUICK_ACTIONS. */}
      {quickActions !== null && (
        <FmFloatingActions
          actions={quickActions ?? DEFAULT_QUICK_ACTIONS}
        />
      )}
    </div>
  );
}
