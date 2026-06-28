"use client";

/**
 * App root — tab state, overlay routing, local persistence.
 *
 * Daily ticks (supplements, practices, feeling, movement) persist in
 * localStorage per client + per day, so the rhythm survives reloads
 * but resets each morning. The weekly check-in posts back to the coach.
 */

import { useEffect, useMemo, useState } from "react";
import type { AppRemedy, ClientAppData } from "@/lib/fmdb/client-app";
import { Icon, Mark, OchreContext } from "./ochre-context";
import { BottomNav, Header } from "./ochre-ui";
import { PlanScreen, TodayScreen, PlanHoldScreen } from "./ochre-screens";
import {
  DiscoverySummaryScreen,
  DiscoveryLockedScreen,
  DiscoveryCoachScreen,
  DiscoveryOnboardingScreen,
} from "./ochre-discovery";
import { EndgameBanner, LibraryFloorScreen, GraduationReport, MaintenanceHome } from "./ochre-endgame";
import { CheckinScreen, DailyFeelingSheet, MoveSheet, type MoveEntry } from "./ochre-checkin";
import { ProgressScreen, type FeelMap } from "./ochre-progress";
import { LabsScreen } from "./ochre-labs";
import { CoachScreen } from "./ochre-coach";
import InstallPrompt from "./ochre-install";
import { AccountOverlay, DocOverlay, MealOverlay, PortionsOverlay, RemedyOverlay } from "./ochre-overlays";
import { BreathOverlay } from "./ochre-breath";
import { EftOverlay } from "./ochre-eft";
import { SleepOverlay } from "./ochre-sleep";
import { GroceryOverlay } from "./ochre-week-menu";
import { MsqOverlay } from "./ochre-msq";
import { OrderOverlay } from "./ochre-order";

interface Stored {
  day?: string;
  logged?: Record<string, string>;
  practicesDone?: Record<string, boolean>;
  submittedWeek?: number;
  feel?: FeelMap;
  moves?: MoveEntry[];
  lastSeenPlanSlug?: string;
  lastSeenUpdatedAt?: string;
}

function nowTime(): string {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Device-level display preference (shared across clients on this phone). */
const TEXT_SIZE_KEY = "ochre.textsize";

/** Movement entries from the trailing 7 days only. */
function thisWeeksMoves(moves: MoveEntry[]): MoveEntry[] {
  const cutoff = Date.now() - 7 * 86_400_000;
  return moves.filter((m) => {
    const ts = parseInt(m.id.replace(/^mv/, ""), 10);
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });
}

type Overlay =
  | { type: "meal"; slot: string }
  | { type: "doc"; doc: { kind: string; id: string } }
  | { type: "remedy"; remedy: AppRemedy }
  | { type: "breath" }
  | { type: "eft" }
  | { type: "sleep" }
  | { type: "grocery" }
  | { type: "msq" }
  | { type: "order" }
  | { type: "portions" }
  | { type: "account" };

export default function OchreApp({ data }: { data: ClientAppData }) {
  const STORE = `ochre.app.${data.clientId}`;

  const [hydrated, setHydrated] = useState(false);
  const [booting, setBooting] = useState(true);
  const [fading, setFading] = useState(false);
  const [tab, setTab] = useState("today");
  const [logged, setLogged] = useState<Record<string, string>>({});
  const [practicesDone, setPracticesDone] = useState<Record<string, boolean>>({});
  const [submittedWeek, setSubmittedWeek] = useState<number>(0);
  const [feel, setFeel] = useState<FeelMap>({});
  const [moves, setMoves] = useState<MoveEntry[]>([]);

  const [inCheckin, setInCheckin] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [feelSheet, setFeelSheet] = useState(false);
  const [moveSheet, setMoveSheet] = useState(false);
  const [planUpdateDismissed, setPlanUpdateDismissed] = useState(false);

  // Larger-text preference — a per-device display setting (NOT part of the
  // daily Stored blob, so it never resets at midnight). Applied as a class on
  // the root `.app` element; the CSS lives under `.app.text-lg` in app.css.
  const [textLarge, setTextLarge] = useState(false);
  useEffect(() => {
    try {
      setTextLarge(localStorage.getItem(TEXT_SIZE_KEY) === "lg");
    } catch {
      /* private mode */
    }
  }, []);
  function changeTextLarge(v: boolean) {
    setTextLarge(v);
    try {
      localStorage.setItem(TEXT_SIZE_KEY, v ? "lg" : "std");
    } catch {
      /* private mode */
    }
  }

  // hydrate persisted state (per client; daily ticks reset each day)
  const [lastSeenPlanSlug, setLastSeenPlanSlug] = useState<string | null>(null);
  const [lastSeenUpdatedAt, setLastSeenUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      const s: Stored = raw ? JSON.parse(raw) : {};
      const day = todayIso();
      if (s.day === day) {
        setLogged(s.logged ?? {});
        setPracticesDone(s.practicesDone ?? {});
      }
      setSubmittedWeek(s.submittedWeek ?? 0);
      setFeel(s.feel ?? {});
      setMoves(thisWeeksMoves(s.moves ?? []));
      setLastSeenPlanSlug(s.lastSeenPlanSlug ?? null);
      setLastSeenUpdatedAt(s.lastSeenUpdatedAt ?? null);
    } catch {
      /* fresh start */
    }
    setHydrated(true);
  }, [STORE]);

  useEffect(() => {
    if (!hydrated) return;
    const s: Stored = { day: todayIso(), logged, practicesDone, submittedWeek, feel, moves, lastSeenPlanSlug: lastSeenPlanSlug ?? undefined, lastSeenUpdatedAt: lastSeenUpdatedAt ?? undefined };
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* storage full / private mode */
    }
  }, [hydrated, logged, practicesDone, submittedWeek, feel, moves, lastSeenPlanSlug, lastSeenUpdatedAt, STORE]);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 900);
    const t2 = setTimeout(() => setBooting(false), 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Adoption: report when the app is running INSTALLED (home-screen /
  // standalone) or an install completes — a truer signal than an "open".
  // The standalone check means a normal browser tab (incl. coach previews)
  // never reports. iOS only ever reports via standalone (no `appinstalled`).
  // Fire-and-forget; server preserves first_installed_at, bumps last_confirmed.
  useEffect(() => {
    const token = data.token;
    if (!token || typeof window === "undefined") return;
    const ua = navigator.userAgent;
    const platform =
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === "MacIntel" &&
        (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1)
        ? "ios"
        : /android/i.test(ua)
          ? "android"
          : "desktop";
    const report = (source: string) => {
      try {
        void fetch("/api/app-installed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, source, platform }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) report("standalone");
    const onInstalled = () => report("appinstalled");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [data.token]);

  // Show the banner when the plan changed since the client last saw it —
  // either a new published version (slug changed) OR an in-place edit such as
  // the coach's quick remedy toggle (planUpdatedAt advanced past last seen).
  const showPlanUpdatedBanner =
    hydrated &&
    !planUpdateDismissed &&
    !!data.planUpdatedAt &&
    ((!!lastSeenPlanSlug && lastSeenPlanSlug !== data.planSlug) ||
      (!!lastSeenUpdatedAt && data.planUpdatedAt > lastSeenUpdatedAt));

  const dismissPlanUpdate = () => {
    setPlanUpdateDismissed(true);
    setLastSeenPlanSlug(data.planSlug);
    if (data.planUpdatedAt) setLastSeenUpdatedAt(data.planUpdatedAt);
  };

  // On first load (no baseline recorded), silently record the current plan
  // slug + content timestamp so only FUTURE changes surface the banner.
  useEffect(() => {
    if (hydrated && lastSeenPlanSlug === null) {
      setLastSeenPlanSlug(data.planSlug);
    }
    if (hydrated && lastSeenUpdatedAt === null && data.planUpdatedAt) {
      setLastSeenUpdatedAt(data.planUpdatedAt);
    }
  }, [hydrated, lastSeenPlanSlug, lastSeenUpdatedAt, data.planSlug, data.planUpdatedAt]);

  const practices = useMemo(
    () => data.practices.map((p) => ({ ...p, done: !!practicesDone[p.id] })),
    [data.practices, practicesDone],
  );

  const toggleSupp = (id: string) =>
    setLogged((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = nowTime();
      return next;
    });
  const logAll = () => {
    const tt = nowTime();
    const next: Record<string, string> = {};
    data.supplements.forEach((s) => {
      next[s.id] = tt;
    });
    data.remedies
      .filter((r) => r.assigned && r.daily)
      .forEach((r) => {
        next["rx-" + r.slug] = tt;
      });
    setLogged(next);
  };
  const togglePractice = (id: string) => setPracticesDone((prev) => ({ ...prev, [id]: !prev[id] }));
  const addMove = (m: { label: string; kind: string; mins: number; day: string }) =>
    setMoves((prev) => [{ ...m, id: "mv" + Date.now(), source: "Logged" }, ...prev]);
  const logFeeling = (v: number) => setFeel((prev) => ({ ...prev, [todayIso()]: v }));

  const scrollTop = () => {
    const sc = document.querySelector(".ochre-app .screen-scroll");
    if (sc) sc.scrollTop = 0;
  };
  const go = (tb: string) => {
    setInCheckin(false);
    setTab(tb);
    scrollTop();
  };

  const openMeal = (slot: string) => setOverlay({ type: "meal", slot });
  const openDoc = (doc: { kind: string; id: string }) => setOverlay({ type: "doc", doc });
  const openRemedy = (remedy: AppRemedy) => setOverlay({ type: "remedy", remedy });
  const openBreath = () => setOverlay({ type: "breath" });
  const openEft = () => setOverlay({ type: "eft" });
  const openSleep = () => setOverlay({ type: "sleep" });
  const openGrocery = () => setOverlay({ type: "grocery" });
  const openMsq = () => setOverlay({ type: "msq" });
  const openOrder = () => setOverlay({ type: "order" });
  const openPortions = () => setOverlay({ type: "portions" });
  const closeOverlay = () => setOverlay(null);

  const dailyRemedies = data.remedies.filter((r) => r.assigned && r.daily);
  const dailyTotal = data.supplements.length + practices.length + dailyRemedies.length;
  const dailyDone = Object.keys(logged).length + practices.filter((p) => p.done).length;

  const submitted = submittedWeek >= data.client.week;
  const goCheckin = () => {
    setInCheckin(true);
    scrollTop();
  };

  // Plan hasn't started yet (coach set a future start date) — show the
  // pre-start "on hold" screen for every plan-content tab. Coach + Labs
  // stay reachable so the client can still message / view past results.
  const onHold = data.client.notStarted;
  // With a committed future Day-1, show the plan FROZEN at its Day-1 state (a
  // live preview) instead of a countdown — client-app clamps the effective
  // date to the start date so every screen renders exactly as it will on the
  // start morning, then advances daily once the plan begins. With NO date set
  // yet, keep the "being set up" hold screen (nothing to preview).
  const previewing = onHold && data.client.startsInDays > 0;
  const setupHold = onHold && !previewing;

  // Consult-tier (no published plan): a read-only Summary + Lab Vault, with
  // Plan/Progress locked and the Coach tab as an upgrade CTA. Resolved upstream
  // in client-app.ts; package clients are never "discovery".
  const discovery = data.tier === "discovery";
  // Pre-call onboarding: a discovery client whose labs aren't in / call isn't
  // done yet. The whole app is the guided onboarding flow (no tabs) — the
  // Starting Map + upgrade countdown stay hidden until post_call.
  const onboarding = discovery && data.discoveryStage != null && data.discoveryStage !== "post_call";

  let screen: React.ReactNode = null;
  if (onboarding) {
    screen = <DiscoveryOnboardingScreen />;
  } else if (discovery) {
    if (tab === "plan") screen = <DiscoveryLockedScreen feature="plan" />;
    else if (tab === "progress") screen = <DiscoveryLockedScreen feature="progress" />;
    else if (tab === "labs") screen = <LabsScreen />;
    else if (tab === "coach") screen = <DiscoveryCoachScreen />;
    else screen = <DiscoverySummaryScreen />; // the "today" slot → Starting Map
  } else if (setupHold && tab !== "coach" && tab !== "labs") {
    screen = <PlanHoldScreen goCoach={() => go("coach")} openOrder={openOrder} />;
  } else if (inCheckin) {
    screen = (
      <CheckinScreen
        submitted={submitted}
        onSubmit={() => {
          setSubmittedWeek(data.client.week);
          scrollTop();
        }}
        onClose={() => {
          setInCheckin(false);
          setTab("progress");
          scrollTop();
        }}
      />
    );
  } else if (data.mode === "REVIEW" && tab === "today") {
    // Wrapping up the 12 weeks — the home becomes the graduation report (real
    // progress deltas + the Continue/Maintain decision). Other tabs stay normal.
    screen = <GraduationReport onContinue={() => go("coach")} onMaintain={() => go("coach")} />;
  } else if (data.mode === "MAINTENANCE" && tab === "today") {
    // Hands-free maintenance — the home surfaces the month's card + back-on-track;
    // menus / recipes / tracking stay open via the other tabs.
    screen = <MaintenanceHome goTab={go} />;
  } else if (data.mode === "LIBRARY" && tab === "today") {
    // Programme complete with no continuation — the home becomes the frozen
    // library floor. Plan / Progress / Labs / Coach stay reachable as-is.
    screen = <LibraryFloorScreen goCoach={() => go("coach")} goTab={go} />;
  } else if (tab === "today") {
    screen = (
      <TodayScreen
        logged={logged}
        onToggleSupp={toggleSupp}
        onLogAll={logAll}
        dailyDone={dailyDone}
        dailyTotal={dailyTotal}
        openMeal={openMeal}
        openRemedy={openRemedy}
        goTab={go}
        goCheckin={goCheckin}
        goCoach={() => go("coach")}
        openBreath={openBreath}
        openEft={openEft}
        openSleep={openSleep}
        practices={practices}
        onTogglePractice={togglePractice}
        openGrocery={openGrocery}
      />
    );
  } else if (tab === "plan") {
    screen = (
      <PlanScreen
        openDoc={openDoc}
        openRemedy={openRemedy}
        openGrocery={openGrocery}
        openOrder={openOrder}
        openPortions={openPortions}
      />
    );
  } else if (tab === "progress") {
    screen = (
      <ProgressScreen goCheckin={goCheckin} feel={feel} onLogFeeling={() => setFeelSheet(true)} moves={moves} onLogMove={() => setMoveSheet(true)} openMsq={openMsq} />
    );
  } else if (tab === "labs") {
    screen = <LabsScreen />;
  } else if (tab === "coach") {
    screen = <CoachScreen coachAlert={!submitted && !onHold} />;
  }

  return (
    <OchreContext.Provider value={data}>
      <div className="ochre-app">
        <div className={"app" + (textLarge ? " text-lg" : "")}>
          <Header alert={!submitted && !onHold} onAccount={() => setOverlay({ type: "account" })} />
          {showPlanUpdatedBanner && (
            <div
              style={{
                background: "var(--sage, #7c9070)",
                color: "#fff",
                fontSize: 13,
                lineHeight: 1.5,
                padding: "10px 14px",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <span style={{ flex: 1 }}>
                <strong>Plan updated</strong>
                {data.planUpdatedAt
                  ? ` · ${new Date(data.planUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                  : ""}
                {data.clientUpdateNote ? ` — ${data.clientUpdateNote}` : ""}
              </span>
              <button
                onClick={dismissPlanUpdate}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: "0 2px",
                  cursor: "pointer",
                  flexShrink: 0,
                  opacity: 0.85,
                }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          {previewing && (
            <div
              style={{
                margin: "8px 12px 0",
                padding: "9px 13px",
                borderRadius: 12,
                background: "rgba(45,90,61,0.10)",
                border: "1px solid rgba(45,90,61,0.22)",
                color: "var(--forest, #2d5a3d)",
                fontSize: 12.5,
                lineHeight: 1.4,
                textAlign: "center",
              }}
            >
              ✦ Preview — this is your plan, ready for <strong>{data.client.startDateLabel}</strong>. It goes
              live and starts moving on its own that day.
            </div>
          )}
          {!inCheckin && !((data.mode === "REVIEW" || data.mode === "MAINTENANCE") && tab === "today") && <EndgameBanner goCoach={() => go("coach")} />}
          <main className="screen-scroll" key={onboarding ? "onboarding" : inCheckin ? "checkin" : tab}>
            {screen}
          </main>
          {!onboarding && (
            <BottomNav active={inCheckin ? "" : tab} onChange={go} coachAlert={!submitted && !onHold} discovery={discovery} />
          )}

          {!booting && <InstallPrompt />}

          {overlay && (
            <div className="overlay show">
              {overlay.type === "meal" && <MealOverlay slot={overlay.slot} onClose={closeOverlay} />}
              {overlay.type === "doc" && <DocOverlay doc={overlay.doc} onClose={closeOverlay} />}
              {overlay.type === "remedy" && <RemedyOverlay remedy={overlay.remedy} onClose={closeOverlay} />}
              {overlay.type === "breath" && data.breathwork && <BreathOverlay bw={data.breathwork} onClose={closeOverlay} />}
              {overlay.type === "eft" && data.eft && <EftOverlay eft={data.eft} onClose={closeOverlay} />}
              {overlay.type === "sleep" && data.sleep && <SleepOverlay sleep={data.sleep} onClose={closeOverlay} />}
              {overlay.type === "grocery" && <GroceryOverlay onClose={closeOverlay} />}
              {overlay.type === "msq" && <MsqOverlay onClose={closeOverlay} />}
              {overlay.type === "order" && <OrderOverlay onClose={closeOverlay} />}
              {overlay.type === "portions" && <PortionsOverlay onClose={closeOverlay} />}
              {overlay.type === "account" && (
                <AccountOverlay onClose={closeOverlay} textLarge={textLarge} onTextLarge={changeTextLarge} />
              )}
            </div>
          )}

          <DailyFeelingSheet show={feelSheet} onClose={() => setFeelSheet(false)} onSave={logFeeling} />
          <MoveSheet show={moveSheet} onClose={() => setMoveSheet(false)} onSave={addMove} />

          {booting && (
            <div className={"token-screen" + (fading ? " fade-out" : "")}>
              <span className="big-mark">
                <Mark size={64} />
              </span>
              <div className="t">The Ochre Tree</div>
              <div className="spinner" />
              <div className="s">Opening your plan…</div>
            </div>
          )}
        </div>
      </div>
    </OchreContext.Provider>
  );
}

/** Friendly error state for invalid / expired links. */
export function OchreAppError() {
  return (
    <div className="ochre-app">
      <div className="app">
        <div className="token-screen" style={{ position: "relative", height: "100dvh" }}>
          <span className="big-mark">
            <Mark size={64} />
          </span>
          <div className="t">The Ochre Tree</div>
          <div className="s" style={{ maxWidth: 260, textAlign: "center", lineHeight: 1.6 }}>
            This link isn’t active any more. Message us on WhatsApp and we’ll send you a fresh one.
          </div>
          <a
            className="wa-btn"
            style={{ width: "auto", padding: "13px 22px", marginTop: 8 }}
            href="https://wa.me/918976563971?text=Hi%2C%20my%20app%20link%20isn%27t%20working%20%E2%80%94%20could%20you%20send%20me%20a%20fresh%20one%3F"
          >
            <Icon name="whatsapp" size={18} /> Message us
          </a>
        </div>
      </div>
    </div>
  );
}
