"use client";

/**
 * AppNutrientsToggle — the coach's switch for grams of protein, carbs, fat and
 * fibre on the client's menu in the new app (client.yaml#app_nutrients,
 * src/lib/fmdb/meal-macros.ts). On by default; off by default for a gentle
 * client (anxiety, SSRI/benzo or eating-disorder signal) until turned on here.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setAppNutrientsAction } from "@/lib/server-actions/food-diary";

export function AppNutrientsToggle({ clientId, on, gentle }: { clientId: string; on: boolean; gentle: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const flip = () =>
    start(async () => {
      const r = await setAppNutrientsAction(clientId, !on);
      if (r.ok) {
        toast.success(!on ? "Menu grams on" : "Menu grams off");
        router.refresh();
      } else {
        toast.error(`Couldn't change it — ${r.error}`);
      }
    });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
        {on ? "Menu grams shown in the app (protein, carbs, fat, fibre)" : "Menu grams hidden in the app"}
        {gentle && !on ? " · off by default for this client (gentle)" : ""}
      </span>
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        style={{
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          background: "transparent",
          color: "var(--fm-text-primary)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {pending ? "Saving…" : on ? "Hide" : "Show"}
      </button>
    </div>
  );
}
