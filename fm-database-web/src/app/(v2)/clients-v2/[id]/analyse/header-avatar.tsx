"use client";

/**
 * HeaderAvatar — tiny 36px client photo for the Analyse-tab compact strip.
 *
 * Lives in its own file because <img onError> can't be passed from a Server
 * Component. Same fallback pattern as FmClientHeader: render the image
 * tag, hide it on 404.
 */
import { useState } from "react";

export function HeaderAvatar({
  clientId,
  displayName,
}: {
  clientId: string;
  displayName: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: "var(--fm-bg-warm)",
          border: "1px solid var(--fm-border-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--fm-primary-dark)",
        }}
      >
        {displayName
          .split(" ")
          .map((p) => p[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </div>
    );
  }

  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 6,
        background: "var(--fm-bg-warm)",
        border: "1px solid var(--fm-border-light)",
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/client-photo/${clientId}`}
        alt={displayName}
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
