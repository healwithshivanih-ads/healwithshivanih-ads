/**
 * /messages — WhatsApp inbox.
 *
 * Lists every inbound WhatsApp message captured from the self-hosted
 * Cloud API server webhook over the last 30 days. Coach can:
 *   - Filter to unread / all / today / 7d
 *   - Click a message to jump to the client's Communicate tab (where
 *     templated replies + per-client thread context live)
 *   - Mark a message read in-place
 *
 * Replies themselves use the existing Communicate tab — that's where
 * the MessageTemplatesPanel + 24h-window reply UX already live. Keeping
 * the inbox a list+route surface means we don't duplicate template
 * picker UI in two places.
 */
import Link from "next/link";
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getInboxMessages, type InboxMessage } from "@/lib/fmdb/loader-extras";
import { InboxFilters } from "./inbox-filters";
import { InboxMarkReadButton } from "./inbox-mark-read-button";

export const dynamic = "force-dynamic";

type FilterId = "unread" | "all" | "today" | "7d";

function isFilterId(s: string | undefined): s is FilterId {
  return s === "unread" || s === "all" || s === "today" || s === "7d";
}

function formatWhen(iso: string | undefined, dateOnly: string): string {
  const stamp = iso || dateOnly;
  if (!stamp) return "";
  try {
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) return stamp;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return stamp;
  }
}

interface ClientRowMin {
  client_id: string;
  display_name?: string;
}

export default async function MessagesInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "unread" } = await searchParams;
  const filterId: FilterId = isFilterId(filter) ? filter : "unread";

  const clients = (await loadAllClients()) as unknown as ClientRowMin[];
  const clientNames = new Map(
    clients.map((c) => [c.client_id, c.display_name ?? c.client_id]),
  );
  const allMessages = await getInboxMessages(
    clients.map((c) => c.client_id),
    clientNames,
    30,
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const cutoff7d = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  })();
  const filtered: InboxMessage[] = allMessages.filter((m) => {
    if (filterId === "unread") return m.is_unread;
    if (filterId === "today") return m.date === todayIso;
    if (filterId === "7d") return (m.created_at ?? m.date) >= cutoff7d;
    return true;
  });

  const counts = {
    unread: allMessages.filter((m) => m.is_unread).length,
    today: allMessages.filter((m) => m.date === todayIso).length,
    "7d": allMessages.filter((m) => (m.created_at ?? m.date) >= cutoff7d).length,
    all: allMessages.length,
  };

  return (
    <FmAppShell activeNavId="messages" crumbs={[{ label: "Messages" }]}>
      <FmPageHeader
        title="Messages"
        subtitle={`Inbound WhatsApp — last 30 days. ${counts.unread > 0 ? `${counts.unread} unread.` : "All caught up."}`}
      />

      <InboxFilters active={filterId} counts={counts} />

      {filtered.length === 0 ? (
        <FmPanel style={{ marginTop: 16 }}>
          <div
            style={{
              padding: "40px 16px",
              textAlign: "center",
              color: "var(--fm-text-secondary)",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <p style={{ fontSize: 13, margin: 0 }}>
              {filterId === "unread"
                ? "Inbox zero — no unread WhatsApp messages."
                : "No inbound messages in this window."}
            </p>
          </div>
        </FmPanel>
      ) : (
        <FmPanel style={{ marginTop: 16, padding: 0 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {filtered.map((m, i) => {
              const displayName = m.display_name ?? m.client_id;
              const isLast = i === filtered.length - 1;
              return (
                <li
                  key={`${m.client_id}-${m.created_at ?? m.date}-${i}`}
                  style={{
                    position: "relative",
                    borderBottom: isLast ? 0 : "1px solid var(--fm-border-light)",
                    background: m.is_unread ? "rgba(46, 110, 213, 0.04)" : "transparent",
                  }}
                >
                  {/* Whole-row link → Communicate. Audit ME1: was only the
                      "Reply →" button before. Mark-read button needs to
                      sit OUTSIDE this link (nested anchors break HTML),
                      so we absolute-position it on top. */}
                  <Link
                    href={`/clients-v2/${m.client_id}/communicate`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "180px minmax(0, 1fr) 80px",
                      gap: 14,
                      alignItems: "center",
                      padding: "12px 16px",
                      paddingRight: m.is_unread ? 130 : 16,
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: m.is_unread ? 700 : 600,
                          color: "var(--fm-text-primary)",
                        }}
                      >
                        {m.is_unread && (
                          <span
                            style={{
                              display: "inline-block",
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: "#2E6ED5",
                              marginRight: 7,
                            }}
                          />
                        )}
                        {displayName}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--fm-text-tertiary)",
                          fontFamily: "var(--fm-font-mono)",
                          marginTop: 1,
                        }}
                      >
                        {m.client_id}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: m.is_unread
                          ? "var(--fm-text-primary)"
                          : "var(--fm-text-secondary)",
                        lineHeight: 1.5,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        fontWeight: m.is_unread ? 500 : 400,
                      }}
                    >
                      {m.text}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--fm-text-tertiary)",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatWhen(m.created_at, m.date)}
                    </span>
                  </Link>
                  {m.is_unread && (
                    <div
                      style={{
                        position: "absolute",
                        right: 16,
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    >
                      <InboxMarkReadButton clientId={m.client_id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </FmPanel>
      )}

      <div
        style={{
          marginTop: 14,
          padding: "8px 12px",
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          fontStyle: "italic",
          lineHeight: 1.5,
        }}
      >
        💡 Reply uses templated WhatsApp via each client&apos;s Communicate tab —
        Meta-approved templates work outside the 24h customer-service window.
        Free-form replies are available inside Communicate when a client message
        landed in the last 24h.
      </div>
    </FmAppShell>
  );
}
