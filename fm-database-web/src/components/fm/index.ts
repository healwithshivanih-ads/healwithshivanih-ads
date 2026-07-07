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

export { FmCallout } from "./FmCallout";
export type { FmCalloutProps } from "./FmCallout";

export { FmStatTile, FmStatGrid } from "./FmStatTile";
export type { FmStatTileProps } from "./FmStatTile";

export { FmAlertGroup } from "./FmAlertGroup";
export type { FmAlertGroupProps } from "./FmAlertGroup";

export { FmGroupedPanel } from "./FmGroupedPanel";
export type { FmGroupedPanelProps, FmGroupedTab } from "./FmGroupedPanel";

export { FmChip, FmStatusPill } from "./FmChip";
export type { FmChipProps, FmStatusPillKind } from "./FmChip";

export { FmAppShell } from "./FmAppShell";
export type { FmAppShellProps } from "./FmAppShell";

export { FmWorkflowBanner } from "./FmWorkflowBanner";
export type { FmWorkflowBannerProps, FmWorkflowStage } from "./FmWorkflowBanner";

export { FmClientHeader } from "./FmClientHeader";
export type { FmClientHeaderProps } from "./FmClientHeader";

export { FmFormDraftClear } from "./FmFormDraftClear";
export type { FmFormDraftClearProps } from "./FmFormDraftClear";

export { FmCollapsibleStep } from "./FmCollapsibleStep";
export type { FmCollapsibleStepProps } from "./FmCollapsibleStep";

export { FmClientJourneyStrip } from "./FmClientJourneyStrip";

export { FmContactPanel } from "./FmContactPanel";
export type { FmContactPanelProps, FmContactRow } from "./FmContactPanel";

export { FmFivePillars } from "./FmFivePillars";
export type {
  FmFivePillarsProps,
  FivePillarsValue,
  DerivedFivePillars,
  DerivedPillarEntry,
} from "./FmFivePillars";

export { FmDepletionBanner } from "./FmDepletionBanner";
export type { FmDepletionBannerProps, DepletionRow } from "./FmDepletionBanner";

export { FmMarkerPanel } from "./FmMarkerPanel";
export type { FmMarkerPanelProps, FmMarker, FmMarkerGroup, MarkerFlag } from "./FmMarkerPanel";

export { FmBodyCompGrid } from "./FmBodyCompGrid";
export type { FmBodyCompGridProps, BodyCompMetric } from "./FmBodyCompGrid";

export { FmCatalogueCommitBanner } from "./FmCatalogueCommitBanner";
export type { FmCatalogueCommitBannerProps } from "./FmCatalogueCommitBanner";
export { FmCatalogueOrphanChip } from "./FmCatalogueOrphanChip";
export { FmVitaoneCoverageChip } from "./FmVitaoneCoverageChip";
export { FmRecipeImageChip } from "./FmRecipeImageChip";

export { FmInboundMessagesBanner } from "./FmInboundMessagesBanner";
export type { FmInboundMessagesBannerProps } from "./FmInboundMessagesBanner";

export { FmIntakeActivityBanner } from "./FmIntakeActivityBanner";
export type { FmIntakeActivityBannerProps } from "./FmIntakeActivityBanner";

export { FmStrandedIntakeBanner } from "./FmStrandedIntakeBanner";
export type { FmStrandedIntakeBannerProps } from "./FmStrandedIntakeBanner";

export { FmScheduleDuePanel } from "./FmScheduleDuePanel";
export type { FmScheduleDuePanelProps } from "./FmScheduleDuePanel";

export { FmUpcomingBookingsPanel } from "./FmUpcomingBookingsPanel";

export { FmCancellationAlertBanner } from "./FmCancellationAlertBanner";

export { FmWhatsAppDraftPanel } from "./FmWhatsAppDraftPanel";
export type { FmWhatsAppDraftPanelProps } from "./FmWhatsAppDraftPanel";

export { FmSessionTypePicker, FM_SESSION_TYPES } from "./FmSessionTypePicker";
export type { FmSessionTypePickerProps, FmSessionTypeId } from "./FmSessionTypePicker";

export { FmSessionTimeline } from "./FmSessionTimeline";
export type { FmSessionTimelineProps, FmSessionTimelineEntry } from "./FmSessionTimeline";

export { FmAnalysisProgress } from "./FmAnalysisProgress";
export type {
  FmAnalysisProgressProps,
  FmProgressStep,
  FmProgressStepStatus,
} from "./FmAnalysisProgress";

export {
  FmFieldLabel,
  FmInput,
  FmTextarea,
  FmPillGroup,
  FmFormSection,
  FmField,
} from "./FmField";
export type {
  FmInputProps,
  FmTextareaProps,
  FmPillOption,
  FmPillGroupProps,
} from "./FmField";

export { FmSymptomPicker } from "./FmSymptomPicker";
export type { FmSymptomPickerProps, FmSymptomOption } from "./FmSymptomPicker";

export { FmFloatingActions } from "./FmFloatingActions";
export type {
  FmFloatingActionsProps,
  FmFloatingActionItem,
} from "./FmFloatingActions";

export { FmCoachNotes } from "./FmCoachNotes";
export type { FmCoachNotesProps, CatalogueChip } from "./FmCoachNotes";

export { FmSupplementGrid } from "./FmSupplementGrid";
export type {
  FmSupplementGridProps,
  FmSupplementGridItem,
} from "./FmSupplementGrid";

export { FmRecheckPanel } from "./FmRecheckPanel";
export type { FmRecheckPanelProps } from "./FmRecheckPanel";

export { FmNutritionPanel } from "./FmNutritionPanel";
export type { FmNutritionPanelProps } from "./FmNutritionPanel";
