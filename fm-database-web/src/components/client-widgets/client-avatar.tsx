"use client";

/**
 * ClientAvatar — circular photo with initials fallback and hover upload.
 *
 * Tries GET /api/client-photo/{clientId}. If 404, shows a coloured initials
 * circle. Hovering shows a "📷" upload overlay; selecting a file calls
 * uploadClientPhotoAction, then refreshes the avatar in-place via blob URL.
 */

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadClientPhotoAction } from "@/lib/server-actions/clients";

interface ClientAvatarProps {
  clientId: string;
  displayName?: string;
  size?: number;           // px; default 60
  className?: string;
}

// Generate a deterministic colour from a string
function nameColor(name: string): string {
  const colours = [
    "#4CAF50", "#2196F3", "#9C27B0", "#FF5722",
    "#795548", "#E91E63", "#009688", "#FF9800",
  ];
  let hash = 0;
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  return colours[Math.abs(hash) % colours.length];
}

function initials(name: string | undefined, id: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return id.slice(0, 2).toUpperCase();
}

export function ClientAvatar({
  clientId,
  displayName,
  size = 60,
  className = "",
}: ClientAvatarProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null | "error">(
    `/api/client-photo/${clientId}`
  );
  const [uploading, setUploading] = useState(false);
  const [hover, setHover] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const label = initials(displayName, clientId);
  const bg    = nameColor(displayName ?? clientId);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);

      // Optimistic preview
      const blobUrl = URL.createObjectURL(file);
      setPhotoUrl(blobUrl);

      const fd = new FormData();
      fd.append("client_id", clientId);
      fd.append("file", file);

      const res = await uploadClientPhotoAction(fd);
      setUploading(false);

      if (!res.ok) {
        console.error("[ClientAvatar] upload failed", res.error);
        setPhotoUrl("error"); // fall back to initials
      } else {
        // Replace blob URL with stable API URL (cache-bust with timestamp)
        setPhotoUrl(`/api/client-photo/${clientId}?t=${Date.now()}`);
        router.refresh();
      }
    },
    [clientId, router]
  );

  const hasPhoto = photoUrl !== null && photoUrl !== "error";
  const fontSize = Math.max(12, Math.round(size * 0.35));

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Main circle */}
      <div
        className="w-full h-full rounded-full overflow-hidden flex items-center justify-center select-none font-bold text-white shadow-sm"
        style={{
          background: hasPhoto ? "transparent" : bg,
          fontSize,
          border: "2px solid rgba(255,255,255,0.8)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        {hasPhoto ? (
          <img
            src={photoUrl as string}
            alt={displayName ?? clientId}
            className="w-full h-full object-cover"
            onError={() => setPhotoUrl("error")}
          />
        ) : (
          label
        )}
      </div>

      {/* Upload overlay — shown on hover */}
      {hover && !uploading && (
        <button
          onClick={() => fileRef.current?.click()}
          className="absolute inset-0 rounded-full flex items-center justify-center text-white text-base"
          style={{ background: "rgba(0,0,0,0.45)" }}
          title="Change photo"
          aria-label="Change photo"
        >
          📷
        </button>
      )}

      {/* Uploading indicator */}
      {uploading && (
        <div
          className="absolute inset-0 rounded-full flex items-center justify-center text-white text-xs"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          ⏳
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          // Reset so same file can be re-selected
          e.target.value = "";
        }}
      />
    </div>
  );
}
