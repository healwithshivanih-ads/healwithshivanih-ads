import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath, getPlansRoot } from "./paths";
import {
  parseContentLibrary,
  resolveLiveness,
  type ContentItem,
  type ContentStatus,
  type GuideStatus,
  type VideoStatus,
} from "./content-library";
import {
  MIN_LONG_VIDEO_SECONDS,
  STATUS_MAX_AGE_DAYS,
  lineFromTitle,
  parseChannelFeed,
  parseWatchPage,
  youtubeIdOf,
  type FeedEntry,
} from "./content-status";
import { classifyConcerns } from "./concerns";

export const CONTENT_LIBRARY_FILE = "_content_library.yaml";
/** Written by the daily content-status job; read by every send path. */
export const CONTENT_STATUS_FILE = "_content_status.yaml";

/** @HealWithShivaniH. */
export const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "UC8aW2BWLN3pykdpYwqwfO7Q";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function todayIst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}

async function readCurated(): Promise<ContentItem[]> {
  try {
    const raw = yaml.load(await fs.readFile(path.join(getCataloguePath(), CONTENT_LIBRARY_FILE), "utf-8"));
    return parseContentLibrary(raw).items;
  } catch {
    return [];
  }
}

export async function loadContentStatus(): Promise<(ContentStatus & { checked_at?: string }) | null> {
  try {
    const d = yaml.load(await fs.readFile(path.join(getPlansRoot(), CONTENT_STATUS_FILE), "utf-8"));
    return d && typeof d === "object" ? (d as ContentStatus & { checked_at?: string }) : null;
  } catch {
    return null;
  }
}

/**
 * The library as it stands TODAY: the curated file plus the videos the job
 * found on the channel, each with the liveFrom YouTube (or the guide page)
 * gave it. Unconfirmed items come back with liveFrom = NEVER, so every picker
 * skips them. Missing file or missing status → nothing is live.
 */
export async function loadContentLibrary(): Promise<ContentItem[]> {
  const [curated, status] = await Promise.all([readCurated(), loadContentStatus()]);
  const known = new Set(curated.map((i) => youtubeIdOf(i.url) ?? i.url));
  const auto = parseContentLibrary({ items: status?.auto_items ?? [] }).items.filter(
    (i) => !known.has(youtubeIdOf(i.url) ?? i.url),
  );
  return resolveLiveness([...curated, ...auto], status, todayIst(), STATUS_MAX_AGE_DAYS, youtubeIdOf);
}

// ── fetching ───────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

async function watchFacts(videoId: string) {
  const r = await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
  return r && r.status === 200 ? parseWatchPage(r.text) : null;
}

/**
 * Is a library link actually public right now? Asked at approval, after the
 * daily status — a premiere can be pulled between the job and the click.
 * YouTube: the watch page must say public (oEmbed alone also answers 200 for
 * an unlisted video). Anything else: the page must answer 200.
 */
export async function linkIsPublic(url: string): Promise<boolean> {
  const vid = youtubeIdOf(url);
  if (vid) return (await watchFacts(vid))?.state === "public";
  const r = await fetchText(url);
  return r?.status === 200;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ContentSyncResult {
  ok: boolean;
  checked: number;
  publicVideos: string[];
  notPublic: string[];
  discovered: string[];
  guidesDown: string[];
  errors: string[];
}

/**
 * The daily job. Asks YouTube about every video it knows (curated, already
 * discovered, and anything new in the channel feed), checks every guide page,
 * and writes _content_status.yaml. A failed or unreadable check leaves that
 * item's previous record untouched (its checked_at goes stale and, after
 * STATUS_MAX_AGE_DAYS, it stops being sent) — a consent wall must not flip a
 * public video to "private", and a network blip must not keep a pulled one
 * "public" for ever.
 */
export async function syncContentStatus(opts: { pauseMs?: number } = {}): Promise<ContentSyncResult> {
  const pause = opts.pauseMs ?? 400;
  const now = new Date().toISOString();
  const today = todayIst();
  const curated = await readCurated();
  const prev = (await loadContentStatus()) ?? {};
  const videos: Record<string, VideoStatus & Record<string, unknown>> = { ...(prev.videos ?? {}) } as never;
  const guides: Record<string, GuideStatus> = { ...(prev.guides ?? {}) };
  const res: ContentSyncResult = { ok: true, checked: 0, publicVideos: [], notPublic: [], discovered: [], guidesDown: [], errors: [] };

  let feed: FeedEntry[] = [];
  const feedRes = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`);
  if (feedRes?.status === 200) feed = parseChannelFeed(feedRes.text);
  else res.errors.push(`channel feed unreachable (${feedRes?.status ?? "network"})`);

  const curatedIds = curated.map((i) => youtubeIdOf(i.url)).filter((x): x is string => Boolean(x));
  const autoPrev = new Map<string, Record<string, unknown>>();
  for (const a of (prev.auto_items ?? []) as Array<Record<string, unknown>>) {
    const id = youtubeIdOf(String(a.url ?? ""));
    if (id) autoPrev.set(id, a);
  }
  // Known shorts need no second look; everything else is re-asked daily.
  const isKnownShort = (id: string) => {
    const v = videos[id] as { length_seconds?: number } | undefined;
    return typeof v?.length_seconds === "number" && v.length_seconds < MIN_LONG_VIDEO_SECONDS;
  };
  const ids = [...new Set([...curatedIds, ...autoPrev.keys(), ...feed.map((f) => f.videoId)])].filter(
    (id) => curatedIds.includes(id) || !isKnownShort(id),
  );

  const auto: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const facts = await watchFacts(id);
    if (pause) await sleep(pause);
    if (!facts || facts.state === "unknown") {
      res.errors.push(`${id}: could not read the watch page`);
      if (autoPrev.has(id)) auto.push(autoPrev.get(id)!);
      continue;
    }
    res.checked++;
    const before = videos[id] as (VideoStatus & { first_public_on?: string }) | undefined;
    videos[id] = {
      state: facts.state,
      published_on: facts.publishedOn,
      checked_at: now,
      title: facts.title ?? undefined,
      length_seconds: facts.lengthSeconds ?? undefined,
      ...(facts.state === "public" ? { first_public_on: before?.first_public_on ?? today } : {}),
    } as never;
    (facts.state === "public" ? res.publicVideos : res.notPublic).push(id);

    // Discovery: a public LONG video that nobody curated.
    if (curatedIds.includes(id)) continue;
    if (facts.state !== "public" || (facts.lengthSeconds ?? 0) < MIN_LONG_VIDEO_SECONDS) continue;
    const fromFeed = feed.find((f) => f.videoId === id);
    const title = facts.title ?? fromFeed?.title ?? "";
    const concerns = classifyConcerns(`${title}\n${(facts.description ?? fromFeed?.description ?? "").slice(0, 500)}`);
    const line = lineFromTitle(title);
    if (!concerns.length || !line) continue;
    auto.push({
      id: `yt-${id}`,
      kind: "video",
      title: title.split("|")[0].trim(),
      url: `https://youtu.be/${id}`,
      concerns,
      stage: "first",
      line,
    });
    if (!autoPrev.has(id)) res.discovered.push(`${id} ${title.slice(0, 60)}`);
  }

  for (const g of curated.filter((i) => i.kind === "guide")) {
    const r = await fetchText(g.url);
    if (!r) {
      res.errors.push(`${g.id}: unreachable`);
      continue;
    }
    const ok = r.status === 200;
    guides[g.url] = { ok, checked_at: now, first_ok_on: guides[g.url]?.first_ok_on ?? (ok ? today : null) };
    if (!ok) res.guidesDown.push(`${g.id} (${r.status})`);
  }

  const out = { checked_at: now, channel_id: YOUTUBE_CHANNEL_ID, videos, guides, auto_items: auto };
  const f = path.join(getPlansRoot(), CONTENT_STATUS_FILE);
  await fs.writeFile(`${f}.tmp`, yaml.dump(out, { lineWidth: -1, noRefs: true, sortKeys: true }), "utf-8");
  await fs.rename(`${f}.tmp`, f);
  return res;
}
