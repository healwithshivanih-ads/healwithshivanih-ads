/**
 * FM v2 primitives — barrel export for ergonomic imports.
 *
 *   import { FmSidebarNav, FmTopBar, FmPanel, FmStatTile, FmChip, FmStatusPill }
 *     from "@/components/fm";
 *
 * Token CSS lives at src/styles/fm-v2.css and must be imported once at the
 * route root (e.g. /dashboard-v2/layout.tsx).
 */
export { FmSidebarNav } from "./FmSidebarNav";
export type { FmNavItem, FmNavSection, FmSidebarNavProps } from "./FmSidebarNav";

export { FmTopBar } from "./FmTopBar";
export type { FmBreadcrumb, FmTopBarProps } from "./FmTopBar";

export { FmPageHeader } from "./FmPageHeader";
export type { FmPageHeaderProps } from "./FmPageHeader";

export { FmPanel, FmInfoRow } from "./FmPanel";
export type { FmPanelProps } from "./FmPanel";

export { FmStatTile, FmStatGrid } from "./FmStatTile";
export type { FmStatTileProps } from "./FmStatTile";

export { FmChip, FmStatusPill } from "./FmChip";
export type { FmChipProps, FmStatusPillKind } from "./FmChip";

export { FmAppShell } from "./FmAppShell";
export type { FmAppShellProps } from "./FmAppShell";
