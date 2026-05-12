"use client";

/**
 * FmClientHeader — top strip on the v2 client detail page.
 *
 * Layout: photo slot (left) · name + meta + workflow banner (centre) ·
 * quick-action buttons (right).
 *
 * Photo upload UX per design 1G — idle (dashed frame + camera icon),
 * hover (highlighted), drag-over (filled + drop-to-upload), uploading
 * (spinner). For Phase 2 the dropzone is just visual; wiring through
 * to the existing photo upload action lands in a follow-up commit.
 */
import { useState } from "react";
import Link from "next/link";
import { FmWorkflowBanner, type FmWorkflowStage } from "./FmWorkflowBanner";

export interface FmClientHeaderProps {
  clientId: string;
  displayName: string;
  age?: number;
  lastSessionDate?: string;
  photoUrl?: string | null;
  stage: FmWorkflowStage;
  stageTitle: React.ReactNode;
  stageDetail?: React.ReactNode;
  stageCta?: React.ReactNode;
  stageCtaHref?: string;
  /** Quick-action buttons rendered on the right (Record / Message / Plan). */
  quickActions?: React.ReactNode;
}

export function FmClientHeader({
  clientId,
  displayName,
  age,
  lastSessionDate,
  photoUrl,
  stage,
  stageTitle,
  stageDetail,
  stageCta,
  stageCtaHref,
  quickActions,
}: FmClientHeaderProps) {
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr auto",
        gap: 20,
        alignItems: "start",
        marginBottom: 24,
      }}
    >
      <PhotoSlot photoUrl={photoUrl ?? null} clientId={clientId} displayName={displayName} />

      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontFamily: "var(--fm-font-display)",
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: "-0.015em",
            margin: "0 0 6px",
            color: "var(--fm-text-primary)",
          }}
        >
          {displayName}
        </h1>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
            fontSize: 12,
            color: "var(--fm-text-tertiary)",
            marginBottom: 12,
          }}
        >
          {age != null && <span>🎂 {age} years</span>}
          <span style={{ fontFamily: "var(--fm-font-mono)" }}>📋 {clientId}</span>
          <span>🕐 Last: {lastSessionDate ?? "Never"}</span>
        </div>

        <FmWorkflowBanner
          stage={stage}
          title={stageTitle}
          detail={stageDetail}
          cta={stageCta}
          ctaHref={stageCtaHref}
        />
      </div>

      {quickActions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {quickActions}
        </div>
      )}
    </header>
  );
}

function PhotoSlot({
  photoUrl,
  clientId,
  displayName,
}: {
  photoUrl: string | null;
  clientId: string;
  displayName: string;
}) {
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);

  if (photoUrl) {
    return (
      <Link
        href={`/clients/${clientId}/files`}
        style={{ display: "block" }}
        title={`${displayName} — replace photo`}
      >
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "var(--fm-radius-md)",
            background: `url(${photoUrl}) center/cover`,
            border: "1px solid var(--fm-border-light)",
          }}
        />
      </Link>
    );
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        // TODO: wire to existing photo upload API in a follow-up.
      }}
      style={{
        width: 120,
        height: 120,
        borderRadius: "var(--fm-radius-md)",
        background: drag
          ? "rgba(255, 107, 53, 0.10)"
          : hover
            ? "rgba(255, 107, 53, 0.06)"
            : "var(--fm-bg-warm)",
        border: drag
          ? "2px solid var(--fm-primary)"
          : hover
            ? "2px dashed var(--fm-primary)"
            : "2px dashed var(--fm-border)",
        color: drag || hover ? "var(--fm-primary)" : "var(--fm-text-tertiary)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        cursor: "pointer",
        transition: "all 160ms var(--fm-ease-out)",
        textAlign: "center",
      }}
    >
      {drag ? (
        <>
          <span style={{ fontSize: 22 }}>⤓</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>Drop to upload</span>
        </>
      ) : hover ? (
        <>
          <span style={{ fontSize: 22 }}>＋</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>Choose file</span>
          <span style={{ fontSize: 9, opacity: 0.7 }}>or drop here</span>
        </>
      ) : (
        <>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7h3l2-3h8l2 3h3v13H3z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Add photo</span>
        </>
      )}
    </div>
  );
}
