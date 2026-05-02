"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/fmdb/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  runAssessAction,
  generateDraftAction,
  uploadFileAction,
  chatAction,
} from "./actions";
import type {
  AssessResult,
  AssessUsage,
  ChatTurn,
} from "@/lib/fmdb/anthropic-types";

type Opt = { slug: string; label: string; aliases?: string[] };

interface Props {
  clients: Client[];
  symptoms: Opt[];
  topics: Opt[];
}

interface UploadedRef {
  filePath: string;
  filename: string;
  mime_type: string;
  kind: "lab_report" | "food_journal";
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchPlaceholder = "search…",
}: {
  label: string;
  options: Opt[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return options.slice(0, 60);
    return options
      .filter((o) => {
        if (o.slug.toLowerCase().includes(ql)) return true;
        if (o.label.toLowerCase().includes(ql)) return true;
        return (o.aliases || []).some((a) => a.toLowerCase().includes(ql));
      })
      .slice(0, 60);
  }, [q, options]);

  const toggle = (slug: string) => {
    if (selected.includes(slug)) onChange(selected.filter((s) => s !== slug));
    else onChange([...selected, slug]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-xs text-muted-foreground">
          {selected.length} selected
        </span>
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
      />
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((s) => (
            <Badge
              key={s}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggle(s)}
            >
              {s} ×
            </Badge>
          ))}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
        {filtered.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No matches</div>
        ) : (
          filtered.map((o) => (
            <label
              key={o.slug}
              className="flex items-start gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.slug)}
                onChange={() => toggle(o.slug)}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="font-medium">{o.label}</span>
                <span className="text-muted-foreground"> ({o.slug})</span>
                {o.aliases && o.aliases.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    aka: {o.aliases.slice(0, 4).join(", ")}
                  </span>
                )}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function UsageStats({ usage, subgraphBytes }: { usage?: AssessUsage; subgraphBytes?: number }) {
  if (!usage) return null;
  return (
    <p className="text-xs text-muted-foreground">
      model: <code>{usage.model || "?"}</code> · in:{" "}
      {usage.input_tokens ?? "?"} · out: {usage.output_tokens ?? "?"} · cache
      read: {usage.cache_read_input_tokens ?? 0} · cache write:{" "}
      {usage.cache_creation_input_tokens ?? 0} · stop:{" "}
      {usage.stop_reason || "?"}
      {subgraphBytes != null && (
        <> · subgraph: {(subgraphBytes / 1024).toFixed(0)} KB</>
      )}
    </p>
  );
}

function SuggestionsView({
  suggestions,
  picks,
  setPicks,
}: {
  suggestions: Record<string, unknown>;
  picks: Record<string, boolean>;
  setPicks: (next: Record<string, boolean>) => void;
}) {
  const isOn = (k: string) => picks[k] ?? true;
  const set = (k: string, v: boolean) => setPicks({ ...picks, [k]: v });

  const Pick = ({ k }: { k: string }) => (
    <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={isOn(k)}
        onChange={(e) => set(k, e.target.checked)}
      />
      include
    </label>
  );

  const drivers = (suggestions.likely_drivers as Array<Record<string, unknown>>) || [];
  const topics = (suggestions.topics_in_play as Array<Record<string, unknown>>) || [];
  const lifestyles = (suggestions.lifestyle_suggestions as Array<Record<string, unknown>>) || [];
  const nutrition = (suggestions.nutrition_suggestions as Record<string, unknown>) || null;
  const supplements = (suggestions.supplement_suggestions as Array<Record<string, unknown>>) || [];
  const labs = (suggestions.lab_followups as Array<Record<string, unknown>>) || [];
  const refs = (suggestions.referral_triggers as Array<Record<string, unknown>>) || [];
  const edu = (suggestions.education_framings as Array<Record<string, unknown>>) || [];
  const extracted = (suggestions.extracted_labs as Array<Record<string, unknown>>) || [];
  const synthesisNotes = suggestions.synthesis_notes as string | undefined;

  return (
    <div className="space-y-4">
      {synthesisNotes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🧐 Synthesis notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{synthesisNotes}</CardContent>
        </Card>
      )}

      {extracted.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🧪 Extracted lab values</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {extracted.map((lab, i) => (
              <div key={i} className="flex gap-2 border-b pb-1">
                <span className="font-medium">{String(lab.test_name ?? "?")}</span>
                <span>
                  {String(lab.value ?? "?")} {String(lab.unit ?? "")}
                </span>
                <Badge variant="outline">{String(lab.flag ?? "—")}</Badge>
                <span className="text-xs text-muted-foreground">
                  {String(lab.fm_interpretation ?? "")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {drivers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🎯 Likely root-cause mechanisms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {drivers.map((d) => {
              const slug = String(d.mechanism_slug ?? "?");
              const k = `driver_${slug}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      #{String(d.rank ?? "?")} — {slug}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {String(d.reasoning ?? "")}
                    </div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {topics.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🗂️ Topics in play</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {topics.map((t) => {
              const slug = String(t.topic_slug ?? "?");
              const role = String(t.role ?? "primary");
              const k = `topic_${slug}_${role}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {role === "primary" ? "🟢" : "🟡"} {slug} ({role})
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {String(t.rationale ?? "")}
                    </div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {lifestyles.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🌿 Lifestyle suggestions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {lifestyles.map((ls, i) => {
              const name = String(ls.name ?? "?");
              const k = `lifestyle_${i}_${name}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {name} <span className="text-muted-foreground text-xs">({String(ls.cadence ?? "?")})</span>
                    </div>
                    {ls.details ? (
                      <div className="text-xs text-muted-foreground">{String(ls.details)}</div>
                    ) : null}
                    <div className="text-xs italic">{String(ls.rationale ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {nutrition && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              🥗 Nutrition
              <Pick k="nutrition_block" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {nutrition.pattern ? <div><strong>Pattern:</strong> {String(nutrition.pattern)}</div> : null}
            {Array.isArray(nutrition.add) && nutrition.add.length > 0 ? (
              <div><strong>Add:</strong> {(nutrition.add as string[]).join(", ")}</div>
            ) : null}
            {Array.isArray(nutrition.reduce) && nutrition.reduce.length > 0 ? (
              <div><strong>Reduce:</strong> {(nutrition.reduce as string[]).join(", ")}</div>
            ) : null}
            {nutrition.meal_timing ? <div><strong>Meal timing:</strong> {String(nutrition.meal_timing)}</div> : null}
            {Array.isArray(nutrition.cooking_adjustment_slugs) && (nutrition.cooking_adjustment_slugs as string[]).length > 0 ? (
              <div><strong>Cooking adjustments:</strong> {(nutrition.cooking_adjustment_slugs as string[]).join(", ")}</div>
            ) : null}
            {Array.isArray(nutrition.home_remedy_slugs) && (nutrition.home_remedy_slugs as string[]).length > 0 ? (
              <div><strong>Home remedies:</strong> {(nutrition.home_remedy_slugs as string[]).join(", ")}</div>
            ) : null}
            {nutrition.rationale ? <div className="text-xs italic">{String(nutrition.rationale)}</div> : null}
          </CardContent>
        </Card>
      )}

      {supplements.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">💊 Supplements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {supplements.map((sp) => {
              const slug = String(sp.supplement_slug ?? "?");
              const k = `supp_${slug}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">{slug}</div>
                    <div className="text-xs">
                      {sp.form ? `${String(sp.form)} · ` : ""}
                      {sp.dose ? `${String(sp.dose)} · ` : ""}
                      {sp.timing ? String(sp.timing) : ""}
                    </div>
                    <div className="text-xs italic">{String(sp.rationale ?? "")}</div>
                    {sp.evidence_tier_caveat ? (
                      <div className="text-xs text-orange-700">
                        ⚠ {String(sp.evidence_tier_caveat)}
                      </div>
                    ) : null}
                    {sp.contraindication_check ? (
                      <div className="text-xs text-red-700">
                        ⚠ {String(sp.contraindication_check)}
                      </div>
                    ) : null}
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {labs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🔬 Lab follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {labs.map((lf, i) => {
              const k = `lab_${i}_${String(lf.test ?? "")}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">{String(lf.test ?? "?")}</div>
                    <div className="text-xs text-muted-foreground">{String(lf.reason ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {refs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">↗️ Referrals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {refs.map((r, i) => {
              const k = `ref_${i}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {String(r.to ?? "?")} <Badge variant="outline">{String(r.urgency ?? "routine")}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{String(r.reason ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {edu.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🎓 Education framings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {edu.map((ed, i) => {
              const k = `edu_${i}_${String(ed.target_slug ?? "")}`;
              return (
                <div key={k} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div className="flex-1">
                    <div className="font-medium">
                      {String(ed.target_kind ?? "topic")}: {String(ed.target_slug ?? "?")}
                    </div>
                    <div className="text-xs">{String(ed.client_facing_summary ?? "")}</div>
                  </div>
                  <Pick k={k} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChatPanel({
  clientId,
  sessionId,
  dryRun,
}: {
  clientId: string;
  sessionId: string;
  dryRun: boolean;
}) {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [usageByIndex, setUsageByIndex] = useState<
    Record<number, AssessUsage | undefined>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSend = () => {
    const msg = draft.trim();
    if (!msg || pending) return;
    setError(null);
    const next: ChatTurn[] = [
      ...history,
      { role: "user", content: msg, at: new Date().toISOString() },
    ];
    setHistory(next);
    setDraft("");
    startTransition(async () => {
      try {
        const res = await chatAction({
          client_id: clientId,
          session_id: sessionId,
          history,
          user_message: msg,
          dry_run: dryRun,
        });
        if (!res.ok || !res.assistant_message) {
          setError(res.error || "Chat call failed");
          return;
        }
        const reply: ChatTurn = {
          role: "assistant",
          content: res.assistant_message,
          at: new Date().toISOString(),
        };
        setHistory((h) => {
          const newHistory = [...h, reply];
          setUsageByIndex((u) => ({ ...u, [newHistory.length - 1]: res.usage }));
          return newHistory;
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          💬 Chat — refine these suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Ask follow-ups: "is ashwagandha safe with Hashimoto's?", "swap
          magnesium-glycinate for magnesium-threonate — implications?". Each
          turn reuses the cached client + catalogue context (~$0.05–0.10).
        </div>

        <div className="border rounded p-3 max-h-[400px] overflow-y-auto bg-muted/30 space-y-3">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No messages yet — ask anything about this assessment.
            </p>
          )}
          {history.map((turn, i) => {
            const isUser = turn.role === "user";
            const usage = usageByIndex[i];
            return (
              <div
                key={i}
                className={
                  isUser
                    ? "flex justify-end"
                    : "flex flex-col items-start gap-1"
                }
              >
                <div
                  className={
                    isUser
                      ? "max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground whitespace-pre-wrap"
                      : "max-w-[85%] rounded-lg px-3 py-2 text-sm bg-background border whitespace-pre-wrap"
                  }
                >
                  {turn.content}
                </div>
                {!isUser && usage && (
                  <span className="text-[10px] text-muted-foreground pl-1">
                    tokens — in: {usage.input_tokens ?? "?"} · out:{" "}
                    {usage.output_tokens ?? "?"} · cache hit:{" "}
                    {usage.cache_read_input_tokens ?? 0}
                    {usage.model ? ` · ${usage.model}` : ""}
                  </span>
                )}
              </div>
            );
          })}
          {pending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              thinking…
            </div>
          )}
        </div>

        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a follow-up… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 rounded border bg-background px-2 py-1 text-sm resize-y min-h-[40px]"
            disabled={pending}
          />
          <Button onClick={onSend} disabled={pending || !draft.trim()}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AssessClient({ clients, symptoms, topics }: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState<string>(clients[0]?.client_id ?? "");
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [complaints, setComplaints] = useState("");
  const [uploads, setUploads] = useState<UploadedRef[]>([]);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [draftPending, startDraft] = useTransition();
  const [uploadPending, startUpload] = useTransition();

  const handleUpload = (
    files: FileList | null,
    kind: "lab_report" | "food_journal"
  ) => {
    if (!files || files.length === 0 || !clientId) return;
    const list = Array.from(files);
    startUpload(async () => {
      const fresh: UploadedRef[] = [];
      for (const file of list) {
        const buf = await file.arrayBuffer();
        const path = await uploadFileAction(
          clientId,
          file.name,
          new Uint8Array(buf)
        );
        fresh.push({
          filePath: path,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          kind,
        });
      }
      setUploads((u) => [...u, ...fresh]);
    });
  };

  const onAnalyze = () => {
    setError(null);
    if (!clientId) {
      setError("Pick a client first");
      return;
    }
    if (
      selectedSymptoms.length === 0 &&
      selectedTopics.length === 0 &&
      uploads.length === 0 &&
      !complaints.trim()
    ) {
      setError("Pick at least one symptom or topic, upload a file, or enter complaints");
      return;
    }
    startTransition(async () => {
      try {
        const res = await runAssessAction({
          client_id: clientId,
          symptoms: selectedSymptoms,
          topics: selectedTopics,
          complaints,
          attachments: uploads.map((u) => ({
            path: u.filePath,
            mime_type: u.mime_type,
            kind: u.kind,
          })),
          dry_run: dryRun,
        });
        if (!res.ok) {
          setError(res.error || "Analyze failed");
          setResult(null);
        } else {
          setResult(res);
          setPicks({});
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const onGenerateDraft = () => {
    if (!result?.session_id || !clientId) return;
    setError(null);
    startDraft(async () => {
      try {
        const res = await generateDraftAction({
          client_id: clientId,
          session_id: result.session_id!,
          picks,
        });
        if (!res.ok) {
          setError(res.error || "Draft generation failed");
        } else if (res.slug) {
          router.push(`/plans/${res.slug}`);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const selectedClient = clients.find((c) => c.client_id === clientId);

  return (
    <div className="space-y-6">
      {/* Step 1: client */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1. Client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clients yet. Create one from the Clients page first.
            </p>
          ) : (
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {clients.map((c) => (
                <option key={c.client_id} value={c.client_id}>
                  {c.client_id}
                  {c.age_band ? ` — ${c.age_band}` : ""}
                  {c.sex ? ` · ${c.sex}` : ""}
                </option>
              ))}
            </select>
          )}
          {selectedClient && (
            <div className="text-xs text-muted-foreground">
              {selectedClient.active_conditions?.length
                ? `Conditions: ${selectedClient.active_conditions.join(", ")}`
                : "No active conditions on file"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: symptoms */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">2. Symptoms</CardTitle>
        </CardHeader>
        <CardContent>
          <MultiSelect
            label="Pick all that apply"
            options={symptoms}
            selected={selectedSymptoms}
            onChange={setSelectedSymptoms}
            searchPlaceholder="search symptoms (name or alias)…"
          />
        </CardContent>
      </Card>

      {/* Step 3: topics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">3. Topics (optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <MultiSelect
            label="Clinical areas in play"
            options={topics}
            selected={selectedTopics}
            onChange={setSelectedTopics}
            searchPlaceholder="search topics…"
          />
        </CardContent>
      </Card>

      {/* Step 4: complaints */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">4. Presenting complaints</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={complaints}
            onChange={(e) => setComplaints(e.target.value)}
            rows={4}
            placeholder="What did the client describe today? Anything that doesn't fit a symptom above…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </CardContent>
      </Card>

      {/* Step 5: uploads */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">5. Lab reports + food journals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Lab reports (PDF / image)</label>
            <input
              type="file"
              multiple
              accept=".pdf,image/*,.txt,.md"
              onChange={(e) => handleUpload(e.target.files, "lab_report")}
              className="block text-sm"
              disabled={uploadPending || !clientId}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Food journals</label>
            <input
              type="file"
              multiple
              accept=".pdf,image/*,.txt,.md"
              onChange={(e) => handleUpload(e.target.files, "food_journal")}
              className="block text-sm"
              disabled={uploadPending || !clientId}
            />
          </div>
          {uploadPending && (
            <p className="text-xs text-muted-foreground">Uploading…</p>
          )}
          {uploads.length > 0 && (
            <div className="text-xs space-y-1">
              {uploads.map((u, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Badge variant="outline">{u.kind}</Badge>
                  <span>{u.filename}</span>
                  <button
                    onClick={() => setUploads(uploads.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analyze button */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Dry run (skip Anthropic — uses synthetic suggestion, $0)
          </label>
          <Button
            onClick={onAnalyze}
            disabled={pending || !clientId}
            className="w-full"
          >
            {pending ? "Synthesizing… (10–60s)" : "🔮 Analyze with AI"}
          </Button>
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result?.ok && result.suggestions && (
        <div className="space-y-4">
          <div className="border-t pt-4">
            <h2 className="text-xl font-semibold">✨ Suggestions</h2>
            <UsageStats
              usage={result.usage}
              subgraphBytes={result.subgraph_size_bytes}
            />
            <p className="text-xs text-muted-foreground">
              session: <code>{result.session_id}</code>
            </p>
          </div>
          <SuggestionsView
            suggestions={result.suggestions}
            picks={picks}
            setPicks={setPicks}
          />
          <Card>
            <CardContent className="pt-6">
              <Button
                onClick={onGenerateDraft}
                disabled={draftPending}
                className="w-full"
              >
                {draftPending ? "Generating draft plan…" : "📝 Generate draft plan"}
              </Button>
            </CardContent>
          </Card>
          {result.session_id && (
            <ChatPanel
              clientId={clientId}
              sessionId={result.session_id}
              dryRun={dryRun}
            />
          )}
        </div>
      )}
    </div>
  );
}
