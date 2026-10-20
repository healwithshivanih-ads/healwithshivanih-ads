"use client";

/**
 * "Ask on WhatsApp" for the 💬 How are we doing panel. Opens the coach's own
 * WhatsApp with the message pre-filled (she sends it) and records the ask, so
 * the row reads "asked <date>" afterwards.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordFeedbackAskAction } from "@/lib/server-actions/programme-feedback";

export function FeedbackAskButton({ clientId, href, asked }: { clientId: string; href: string; asked: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        startTransition(async () => {
          await recordFeedbackAskAction(clientId, "whatsapp");
          router.refresh();
        })
      }
      style={{
        flexShrink: 0,
        border: "1px solid rgba(37, 211, 102, 0.5)",
        color: "#128c4b",
        borderRadius: "var(--fm-radius-pill)",
        padding: "4px 12px",
        fontSize: 12,
        fontWeight: 700,
        textDecoration: "none",
        opacity: pending ? 0.6 : 1,
      }}
    >
      💬 {asked ? "Ask again" : "Ask on WhatsApp"}
    </a>
  );
}
