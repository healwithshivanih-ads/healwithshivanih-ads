/**
 * /m/clients/[id]/chat — the conversation, on the coach's phone.
 *
 * One thread, both channels: in-app messages merged with WhatsApp history so
 * there is never a second place to look. Replies go in-app, which costs
 * nothing and is not bound by Meta's 24-hour window.
 */
import { notFound } from "next/navigation";
import { loadCoachCard } from "@/lib/fmdb/coach-mobile";
import { loadClientChatAction } from "@/lib/server-actions/client-chat";
import { BackLink } from "../../../../ui";
import { ChatPanel } from "./chat-panel";

export const dynamic = "force-dynamic";

export default async function ClientChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = loadCoachCard(id);
  if (!card) notFound();

  const name = String((card.glance as Record<string, unknown>).display_name ?? card.id);
  const first = name.split(" ")[0];
  const res = await loadClientChatAction(card.id);

  return (
    <main className="m-page" style={{ display: "flex", flexDirection: "column" }}>
      <div className="m-pagehead">
        <BackLink href={`/m/clients/${card.id}`} label={first} />
        <h1 style={{ fontSize: "var(--fm-text-xl)", marginTop: 12 }}>{name}</h1>
      </div>
      <ChatPanel clientId={card.id} firstName={first} initial={res.messages} />
    </main>
  );
}
