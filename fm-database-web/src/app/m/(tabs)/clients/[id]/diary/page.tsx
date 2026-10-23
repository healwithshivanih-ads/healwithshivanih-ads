/**
 * /m/clients/[id]/diary — the food diary on the coach's phone
 * (docs/FOOD_DIARY_PLAN.md). Read-only: start / end / correct live on the
 * desktop Record tab. This is for glancing at what came in, day by day.
 *
 * Reads the diary from whichever host serves it — on Fly that is the staged
 * copy, where the client's photos are written first; on the Mac the
 * authoritative store. Photos come through /api/m/media (behind the /m
 * session gate), the same route the meal-photo queue uses.
 */
import { notFound } from "next/navigation";
import { loadCoachCard } from "@/lib/fmdb/coach-mobile";
import { readDiaryConfig, loadDiary } from "@/lib/fmdb/food-diary-store";
import {
  DIARY_BAND_LABEL,
  diaryFinishedOn,
  diaryGrid,
  diaryLastDay,
  entryDishes,
  entryReadState,
} from "@/lib/fmdb/food-diary";
import { readDiarySummary } from "@/lib/fmdb/food-diary-store";
import { BackLink, Card, Eyebrow } from "../../../../ui";

export const dynamic = "force-dynamic";

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function clock(t: string): string {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export default async function DiaryView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = loadCoachCard(id);
  if (!card) notFound();
  const name = String((card.glance as Record<string, unknown>).display_name ?? card.id);
  const cfg = readDiaryConfig(card.id);
  const folded = cfg ? loadDiary(card.id, cfg) : null;
  const grid = cfg && folded ? diaryGrid(cfg, folded.entries) : [];
  // The summary line once it is on the record (written on the Mac; on Fly the
  // session file is not projected, so this shows on the Mac's /m only).
  const summary = cfg ? readDiarySummary(card.id, cfg.id) : null;

  return (
    <main className="m-page">
      <BackLink href={`/m/clients/${card.id}`} label={name.split(" ")[0]} />
      <h1 style={{ fontSize: "var(--fm-text-xl)", margin: "16px 0 4px" }}>Food diary</h1>
      {!cfg ? (
        <p className="m-subtle">No food diary on this client. Start one from the Record tab on your desk.</p>
      ) : (
        <p className="m-subtle">
          {fmtDay(cfg.start)} – {fmtDay(cfg.status === "ended" ? diaryFinishedOn(cfg) : diaryLastDay(cfg))}
          {cfg.status === "ended" ? " · ended" : ""}
          {cfg.focus ? ` · looking for: ${cfg.focus}` : ""}
        </p>
      )}
      {summary && <Card>{summary.line}</Card>}

      {grid.map((d) => (
        <section key={d.date}>
          <Eyebrow>
            Day {d.dayNumber} · {fmtDay(d.date)}
            {folded?.daysDone.has(d.date) ? " · done" : ""}
          </Eyebrow>
          {d.count === 0 ? (
            <p className="m-subtle" style={{ margin: "0 2px" }}>
              No photos.
            </p>
          ) : (
            <Card>
              {d.bands
                .filter((b) => b.entries.length > 0)
                .map((b) => (
                  <div key={b.band} style={{ marginBottom: 12 }}>
                    <div className="m-label">{DIARY_BAND_LABEL[b.band]}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {b.entries.map((e) => (
                        <a
                          key={e.entry_id}
                          href={`/api/m/media?client=${encodeURIComponent(card.id)}&file=${encodeURIComponent(e.photo)}&scope=diary`}
                          style={{ width: 96, textDecoration: "none", color: "inherit" }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- client diary photo behind the /m gate */}
                          <img
                            src={`/api/m/media?client=${encodeURIComponent(card.id)}&file=${encodeURIComponent(e.photo)}&scope=diary`}
                            alt={e.coach_label || e.note || "diary photo"}
                            style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, display: "block" }}
                          />
                          <span className="m-subtle" style={{ display: "block", fontSize: 11 }}>
                            {clock(e.time)}
                          </span>
                          {entryReadState(e) === "unreadable" ? (
                            <span style={{ display: "block", fontSize: 11, color: "var(--fm-danger)" }}>couldn&apos;t read</span>
                          ) : entryReadState(e) === "pending" ? (
                            <span className="m-subtle" style={{ display: "block", fontSize: 11 }}>reading…</span>
                          ) : (
                            <span style={{ display: "block", fontSize: 11 }}>{entryDishes(e).join(", ")}</span>
                          )}
                          {e.note && (
                            <span className="m-subtle" style={{ display: "block", fontSize: 11 }}>
                              “{e.note}”
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
            </Card>
          )}
        </section>
      ))}
    </main>
  );
}
