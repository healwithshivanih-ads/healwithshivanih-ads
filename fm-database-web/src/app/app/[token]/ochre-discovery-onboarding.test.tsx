/**
 * Getting started — the screen between signing up and the plan.
 *
 * Two things a client reads here are pinned:
 *  - the labs step says the LIST is ready. "Your labs are ready" read as if
 *    the results were in, before a single test had been booked;
 *  - every stage says where it is in words ("Step N of 4"), because the bars
 *    under the card are decorative and hidden from a screen reader.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryOnboardingScreen } from "./ochre-discovery";
import { OchreContext } from "./ochre-context";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import type { DiscoveryStage } from "@/lib/fmdb/discovery-tier";

function render(stage: DiscoveryStage, tier: "enrolled" | "discovery" = "enrolled"): string {
  // Synthetic client; only the fields this screen reads.
  const data = {
    tier,
    discoveryStage: stage,
    token: "t",
    clientId: "cl-000",
    client: { firstName: "Asha" },
    coach: { whatsappNumber: "910000000000" },
    intakeUrl: "/intake/x",
    labOrders: [],
  } as unknown as ClientAppData;
  return renderToStaticMarkup(
    <OchreContext.Provider value={data}>
      <DiscoveryOnboardingScreen />
    </OchreContext.Provider>,
  );
}

describe("Getting started screen", () => {
  it("the labs step says the list is ready, not the labs", () => {
    const html = render("book_labs");
    expect(html).toContain("Your lab list is ready");
    expect(html).not.toContain("Your labs are ready");
  });

  it("names the step in words on every stage", () => {
    const expected: [DiscoveryStage, string][] = [
      ["onboard_intake", "Step 1 of 4 · Your intake"],
      ["awaiting_recommendation", "Step 2 of 4 · Book labs"],
      ["book_labs", "Step 2 of 4 · Book labs"],
      ["awaiting_results", "Step 3 of 4 · Sample &amp; results"],
      ["awaiting_call", "Step 4 of 4 · Your plan"],
    ];
    for (const [stage, label] of expected) {
      expect(render(stage).replace(/<!-- -->/g, "")).toContain(label);
    }
  });

  it("a discovery client's last step is the call, an enrolled client's is the plan", () => {
    expect(render("awaiting_call", "discovery").replace(/<!-- -->/g, "")).toContain("Step 4 of 4 · Discovery call");
    expect(render("awaiting_call", "enrolled").replace(/<!-- -->/g, "")).toContain("Step 4 of 4 · Your plan");
  });

  it("greets the client by first name without the script face", () => {
    const html = render("book_labs");
    expect(html).toContain("Hi Asha");
    expect(html).not.toContain('class="date script"');
  });
});
