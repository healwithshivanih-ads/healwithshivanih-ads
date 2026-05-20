/**
 * /clients-v2/new — v2 new-client form.
 *
 * Mounts the existing v1 NewClientForm with initialOpen=true so the
 * coach lands directly on the expanded form. After successful create,
 * the form router.push()es to /clients-v2/<id> (already updated).
 *
 * Replaces the /clients?new=1 escape hatch that FmAppShell sidebar
 * + /clients-v2 list "+ New client" CTAs were pointing at.
 */
import Link from "next/link";
import { FmAppShell, FmPageHeader } from "@/components/fm";
import { NewClientForm } from "@/components/client-widgets/new-client-form";

export const dynamic = "force-dynamic";

export default function NewClientPage() {
  return (
    <FmAppShell
      activeNavId="new-client"
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: "New client" },
      ]}
    >
      <FmPageHeader
        as="h1"
        size="lg"
        title="➕ New client"
        subtitle="Drop a Calendly intake transcript or pre-call form to auto-fill, or fill the fields manually. Required: client name + sex + intake date."
        rightSlot={
          <Link
            href="/clients-v2"
            style={{
              fontSize: 12,
              color: "var(--fm-text-secondary)",
              textDecoration: "none",
              padding: "6px 12px",
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
            }}
          >
            ← Back to clients
          </Link>
        }
      />
      <div className="fm-v2-host" style={{ marginTop: 16 }}>
        {/* fm-v2-host re-skins the shadcn+Tailwind primitives inside the
            new-client form (inputs / buttons / cards / selects) to FM
            tokens so the form stops looking visually distinct from the
            rest of the v2 app. Wave H 2026-05-20. */}
        <NewClientForm initialOpen />
      </div>
    </FmAppShell>
  );
}
