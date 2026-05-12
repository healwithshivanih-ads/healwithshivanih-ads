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

export { FmWorkflowBanner } from "./FmWorkflowBanner";
export type { FmWorkflowBannerProps, FmWorkflowStage } from "./FmWorkflowBanner";

export { FmClientHeader } from "./FmClientHeader";
export type { FmClientHeaderProps } from "./FmClientHeader";

export { FmContactPanel } from "./FmContactPanel";
export type { FmContactPanelProps, FmContactRow } from "./FmContactPanel";

export { FmFivePillars } from "./FmFivePillars";
export type { FmFivePillarsProps, FivePillarsValue } from "./FmFivePillars";

export { FmDepletionBanner } from "./FmDepletionBanner";
export type { FmDepletionBannerProps, DepletionRow } from "./FmDepletionBanner";

export { FmMarkerPanel } from "./FmMarkerPanel";
export type { FmMarkerPanelProps, FmMarker, FmMarkerGroup, MarkerFlag } from "./FmMarkerPanel";

export { FmBodyCompGrid } from "./FmBodyCompGrid";
export type { FmBodyCompGridProps, BodyCompMetric } from "./FmBodyCompGrid";

export { FmCatalogueCommitBanner } from "./FmCatalogueCommitBanner";
export type { FmCatalogueCommitBannerProps } from "./FmCatalogueCommitBanner";

export { FmAisensyBanner } from "./FmAisensyBanner";
export type { FmAisensyBannerProps } from "./FmAisensyBanner";

export { FmWhatsAppDraftPanel } from "./FmWhatsAppDraftPanel";
export type { FmWhatsAppDraftPanelProps } from "./FmWhatsAppDraftPanel";
