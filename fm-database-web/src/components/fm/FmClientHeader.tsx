"use client";

/**
 * FmClientHeader — top strip on the v2 client detail page.
 *
 * Layout: photo slot (left) · name + meta + workflow banner (centre) ·
 * quick-action buttons (right).
 *
 * Photo upload UX per design 1G — idle (dashed frame + camera icon),
 * hover (highlighted), drag-over (filled + drop-to-upload), uploading
 * (spinner). Wired through to the existing uploadClientPhotoAction so the
 * dropzone is functional, not just visual.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { uploadClientPhotoAction } from "@/lib/server-actions/clients";
import { formatLongDate } from "@/lib/fmdb/format-date";
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
  /** Fix F5 2026-05-23 — FM root-cause label from intake_insights.
   *  Renders as a one-line indigo strip under the name so coach sees
   *  the keystone driver before the workflow banner. Hidden when null. */
  rootCauseLabel?: string | null;
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
  rootCauseLabel,
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
          <span>🕐 Last contact: {lastSessionDate ? formatLongDate(lastSessionDate) : "Never"}</span>
        </div>

        {/* Fix F5 2026-05-23 — root-cause keystone strip above the
            workflow banner. Coach sees the FM driver at the highest
            possible position on the client page (just under the name).
            Self-hides for legacy clients without intake_insights. */}
        {rootCauseLabel && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              marginBottom: 10,
              background: "rgba(46,125,90,0.07)",
              border: "1px solid rgba(46,125,90,0.28)",
              borderRadius: 5,
              fontSize: 12.5,
              lineHeight: 1.4,
              color: "var(--fm-text-primary)",
            }}
            title="From the intake AI summary — anchors every protocol decision"
          >
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "#2e7d5a",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              🎯 Driving
            </span>
            <span style={{ fontWeight: 500 }}>{rootCauseLabel}</span>
          </div>
        )}

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
  photoUrl: initialPhotoUrl,
  clientId,
  displayName,
}: {
  photoUrl: string | null;
  clientId: string;
  displayName: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // Always START by trying the photo API. If the file doesn't exist on disk,
  // the <img> below fires onError and we drop back to the empty-state UI.
  // This way we don't depend on client.photo_filename being patched after
  // upload — the file itself is the source of truth.
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    initialPhotoUrl ?? `/api/client-photo/${clientId}`,
  );
  const [photoFailed, setPhotoFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Photo must be an image (JPG, PNG, HEIC)");
      return;
    }
    setUploading(true);
    // Optimistic blob preview
    const blob = URL.createObjectURL(file);
    setPhotoUrl(blob);

    const fd = new FormData();
    fd.append("client_id", clientId);
    fd.append("file", file);
    const r = await uploadClientPhotoAction(fd);
    setUploading(false);

    if (r.ok) {
      // Swap blob for stable API URL (cache-bust)
      setPhotoUrl(`/api/client-photo/${clientId}?t=${Date.now()}`);
      setPhotoFailed(false);
      toast.success(`Photo set for ${displayName.split(" ")[0]}`);
      router.refresh();
    } else {
      toast.error(r.error ?? "Photo upload failed");
      setPhotoUrl(initialPhotoUrl); // revert
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    await handleFile(file);
  };

  // Filled photo state — clicking still opens picker. We render an actual
  // <img> so onError can fire when the file doesn't exist (HTTP 404 from
  // /api/client-photo) and we fall through to the empty dropzone below.
  if (photoUrl && !photoFailed && !uploading) {
    return (
      <>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          title={`${displayName} — drop or click to replace`}
          style={{
            width: 120,
            height: 120,
            borderRadius: "var(--fm-radius-md)",
            overflow: "hidden",
            border: drag
              ? "2px solid var(--fm-primary)"
              : "1px solid var(--fm-border-light)",
            cursor: "pointer",
            position: "relative",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={displayName}
            onError={() => setPhotoFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
          {drag && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(255, 107, 53, 0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              ⤓ Drop to replace
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileRef.current?.click()}
        style={{
          width: 120,
          height: 120,
          borderRadius: "var(--fm-radius-md)",
          background: uploading
            ? "rgba(0, 78, 137, 0.06)"
            : drag
              ? "rgba(255, 107, 53, 0.10)"
              : hover
                ? "rgba(255, 107, 53, 0.06)"
                : "var(--fm-bg-warm)",
          border: uploading
            ? "2px solid var(--fm-secondary)"
            : drag
              ? "2px solid var(--fm-primary)"
              : hover
                ? "2px dashed var(--fm-primary)"
                : "2px dashed var(--fm-border)",
          color: uploading
            ? "var(--fm-secondary)"
            : drag || hover
              ? "var(--fm-primary)"
              : "var(--fm-text-tertiary)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          cursor: uploading ? "wait" : "pointer",
          transition: "all 160ms var(--fm-ease-out)",
          textAlign: "center",
        }}
      >
        {uploading ? (
          <>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: "2.5px solid rgba(0,78,137,0.2)",
                borderTopColor: "var(--fm-secondary)",
                animation: "fm-spin 0.8s linear infinite",
              }}
            />
            <span style={{ fontSize: 10, fontWeight: 700 }}>Uploading…</span>
            <style>{`@keyframes fm-spin { to { transform: rotate(360deg); } }`}</style>
          </>
        ) : drag ? (
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
    </>
  );
}
