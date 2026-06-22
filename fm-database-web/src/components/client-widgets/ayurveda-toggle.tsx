"use client";

/**
 * Per-client Ayurveda toggle (Overview). Master switch for the optional
 * Ayurveda layer: when on, the assess suggester scores constitution, the plan
 * editor shows the 🪔 Ayurveda section, and consolidated + lifestyle_guide
 * letters render the Ayurvedic block.
 *
 * Constitution (prakruti) is coach-confirmed here — it's established by the
 * dosha self-assessment quiz, not guessed from current symptoms. The AI's
 * latest read (if any) is shown read-only as a suggestion the coach can copy in.
 *
 * Optimistic update + save via updateClientPreferences.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateClientPreferences } from "@/lib/server-actions/clients";
import { reissueDoshaQuizAction, getDoshaQuizLinkAction } from "@/lib/server-actions/intake";

interface Props {
  clientId: string;
  initialEnabled?: boolean;
  initialConstitution?: string;
  /** Decoupled dosha-quiz-in-intake switch (Client.collect_dosha_quiz).
   *  Default on for new clients; independent of the layer master switch. */
  initialCollectDoshaQuiz?: boolean;
  /** AI read from the latest assess pass, if any. */
  assessment?: Record<string, unknown> | null;
}

export function AyurvedaToggle({
  clientId,
  initialEnabled,
  initialConstitution,
  initialCollectDoshaQuiz,
  assessment,
}: Props) {
  const [enabled, setEnabled] = useState<boolean>(Boolean(initialEnabled));
  const [collectDosha, setCollectDosha] = useState<boolean>(Boolean(initialCollectDoshaQuiz));
  const [constitution, setConstitution] = useState<string>(initialConstitution ?? "");
  const [savedConstitution, setSavedConstitution] = useState<string>(initialConstitution ?? "");
  const [pending, start] = useTransition();

  const [quizSending, startQuiz] = useTransition();
  const [linkLoading, startLink] = useTransition();
  // Copyable dosha-quiz link for manual delivery — surfaced when WhatsApp
  // delivery is flaky (Meghana 2026-06-22: quiz "sent" but never arrived).
  const [manualLink, setManualLink] = useState<string>("");
  const a = assessment ?? {};
  const suggestedPrakruti = typeof a.prakruti_label === "string" ? a.prakruti_label : "";
  const prakrutiConf = typeof a.prakruti_confidence === "string" ? a.prakruti_confidence : "";
  const prakrutiPending = prakrutiConf === "pending_quiz";
  const vikruti = typeof a.vikruti_label === "string" ? a.vikruti_label : "";
  // Low confidence on the client's TYPE → advise the coach to confirm via the
  // quiz or reconsider whether Ayurveda fits this client yet. Keyed on the AI's
  // confidence (not on whether a constitution string is set — a provisional
  // constitution is still low-confidence). Only fires once a read exists.
  const lowConfidence =
    (prakrutiConf === "low" || prakrutiConf === "pending_quiz") &&
    (suggestedPrakruti !== "" || vikruti !== "" || constitution.trim() !== "");

  const sendQuiz = () => {
    startQuiz(async () => {
      const r = await reissueDoshaQuizAction(clientId);
      if (!r.ok) toast.error(r.error ?? "Failed to send");
      else {
        // Also surface the link so the coach can re-send manually if the
        // WhatsApp message doesn't land (Meta accepts the send but delivery
        // can still fail silently — see _whatsapp_delivery_failures.yaml).
        setManualLink(r.url);
        toast.success(r.via === "template" ? "Dosha quiz sent on WhatsApp" : "Dosha quiz sent (free-text)");
      }
    });
  };

  const getLink = () => {
    startLink(async () => {
      const r = await getDoshaQuizLinkAction(clientId);
      if (!r.ok) toast.error(r.error ?? "Failed to get link");
      else {
        setManualLink(r.url);
        toast.success("Link ready — copy it below");
      }
    });
  };

  const copyLink = async () => {
    if (!manualLink) return;
    try {
      await navigator.clipboard.writeText(manualLink);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — select and copy the link manually");
    }
  };

  const saveEnabled = (next: boolean) => {
    setEnabled(next);
    start(async () => {
      const r = await updateClientPreferences({ client_id: clientId, ayurveda_enabled: next });
      if (!r.ok) {
        toast.error(r.error ?? "Save failed");
        setEnabled(!next);
      } else {
        toast.success(next ? "Ayurveda enabled for this client" : "Ayurveda disabled");
      }
    });
  };

  const saveCollectDosha = (next: boolean) => {
    setCollectDosha(next);
    start(async () => {
      const r = await updateClientPreferences({ client_id: clientId, collect_dosha_quiz: next });
      if (!r.ok) {
        toast.error(r.error ?? "Save failed");
        setCollectDosha(!next);
      } else {
        toast.success(next ? "Dosha questions added to intake" : "Dosha questions removed from intake");
      }
    });
  };

  const saveConstitution = () => {
    if (constitution === savedConstitution) return;
    start(async () => {
      const r = await updateClientPreferences({
        client_id: clientId,
        ayurveda_constitution: constitution,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Save failed");
      } else {
        setSavedConstitution(constitution);
        toast.success("Constitution saved");
      }
    });
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(217, 162, 80, 0.06)",
        border: "1px solid rgba(217, 162, 80, 0.30)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <label
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => saveEnabled(e.target.checked)}
        />
        🪔 Ayurveda layer for this client
      </label>
      <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", margin: "4px 0 0 24px" }}>
        Constitution scoring in assessments + an Ayurvedic section in the plan &amp; letters.
      </p>

      {/* Decoupled, default-on dosha-questions-in-intake switch. Independent
          of the master layer above — gathers the lifelong constitution
          baseline up front so it's ready if/when the layer is turned on. */}
      <label
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, marginTop: 12 }}
      >
        <input
          type="checkbox"
          checked={collectDosha}
          disabled={pending}
          onChange={(e) => saveCollectDosha(e.target.checked)}
        />
        🧬 Dosha questions in intake
      </label>
      <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", margin: "4px 0 0 24px" }}>
        On by default — the intake form gathers the client&apos;s lifelong constitution
        (dosha) baseline so it&apos;s ready if you turn on the layer above. Untick to leave
        it out of this client&apos;s intake. Independent of the switch above.
      </p>

      {enabled && (
        <div style={{ marginTop: 10, paddingLeft: 24 }}>
          {lowConfidence && (
            <div
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                background: "rgba(220, 38, 38, 0.06)",
                border: "1px solid rgba(220, 38, 38, 0.35)",
                borderRadius: "var(--fm-radius-sm)",
                fontSize: 11.5,
                color: "#9a1f1f",
                lineHeight: 1.45,
              }}
            >
              ⚠ <strong>Low confidence on this client&apos;s Ayurvedic type.</strong> The
              constitution read is only provisional{prakrutiPending ? " (no dosha quiz yet)" : ""}.
              Send the dosha quiz to establish it, <em>or consider whether the Ayurveda layer is
              right for this client yet</em> — you can switch it off above. (The current-state
              vikruti guidance is more reliable than the constitution read.)
            </div>
          )}
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--fm-text-tertiary)", marginBottom: 4 }}>
            Constitution (prakruti) — coach-confirmed
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={constitution}
              disabled={pending}
              placeholder="e.g. Pitta-Vata — set from the dosha quiz"
              onChange={(e) => setConstitution(e.target.value)}
              onBlur={saveConstitution}
              style={{
                flex: 1,
                fontSize: 12,
                padding: "6px 8px",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                background: "var(--fm-surface)",
              }}
            />
          </div>
          {suggestedPrakruti && suggestedPrakruti !== constitution && (
            <button
              onClick={() => { setConstitution(suggestedPrakruti); }}
              disabled={pending}
              style={{ marginTop: 5, fontSize: 11, color: "var(--fm-primary)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >
              Use AI suggestion: {suggestedPrakruti} →
            </button>
          )}
          {prakrutiPending && !suggestedPrakruti && (
            <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 5, fontStyle: "italic" }}>
              Constitution is established by the dosha self-assessment quiz — send the client the
              quiz, or set it here from your own assessment.
            </p>
          )}
          {vikruti && (
            <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 6 }}>
              <strong>Current read (vikruti):</strong> {vikruti}
            </p>
          )}
          <button
            onClick={sendQuiz}
            disabled={quizSending}
            style={{
              marginTop: 10, fontSize: 12, fontWeight: 600, padding: "5px 12px",
              borderRadius: "var(--fm-radius-sm)", border: "1px solid rgba(217,162,80,0.5)",
              background: "rgba(217,162,80,0.12)", color: "#9a6b1f",
              cursor: quizSending ? "wait" : "pointer",
            }}
            title="WhatsApp the client the lifelong-frame dosha quiz — its answers establish their prakruti (high-confidence constitution)."
          >
            {quizSending ? "Sending…" : "📨 Send dosha quiz (establishes prakruti)"}
          </button>

          {/* Manual-delivery fallback — copy the link and send it yourself on
              any channel when WhatsApp delivery is unreliable. */}
          <button
            onClick={getLink}
            disabled={linkLoading}
            style={{
              marginTop: 8, marginLeft: 8, fontSize: 12, fontWeight: 600, padding: "5px 12px",
              borderRadius: "var(--fm-radius-sm)", border: "1px solid var(--fm-border)",
              background: "var(--fm-surface)", color: "var(--fm-text-secondary)",
              cursor: linkLoading ? "wait" : "pointer",
            }}
            title="Mint the dosha-quiz link without sending — copy it and deliver it manually (WhatsApp, email, SMS…)."
          >
            {linkLoading ? "Getting link…" : "🔗 Get link to send manually"}
          </button>

          {manualLink && (
            <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="text"
                readOnly
                value={manualLink}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: 1, fontSize: 11.5, padding: "6px 8px",
                  border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)",
                  background: "var(--fm-surface)", fontFamily: "monospace",
                }}
              />
              <button
                onClick={copyLink}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "6px 10px", whiteSpace: "nowrap",
                  borderRadius: "var(--fm-radius-sm)", border: "1px solid rgba(217,162,80,0.5)",
                  background: "rgba(217,162,80,0.12)", color: "#9a6b1f", cursor: "pointer",
                }}
              >
                📋 Copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
