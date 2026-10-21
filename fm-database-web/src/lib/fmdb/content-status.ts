/**
 * What YouTube says about a video right now — the ONLY thing that decides
 * whether a video may be put in an email.
 *
 * WHY. Hand-kept go-live dates were wrong within a day of being written: the
 * HRT video went public on 18 Oct while the library said 28 Feb 2027, the belly
 * video on 11 Oct while it said 18 Oct. Premieres move in Studio and nobody
 * re-types the date. So the daily `content-status` job asks YouTube itself
 * and this module reads the answer:
 *
 *   - the watch page carries `playabilityStatus` (OK for a playable video,
 *     LOGIN_REQUIRED for a private / not-yet-premiered one), `isUnlisted`,
 *     `isUpcoming`, `publishDate` and `lengthSeconds`;
 *   - the channel's public feed (videos.xml) lists the latest 15 PUBLIC
 *     uploads, which is how new videos are found without anyone adding them.
 *
 * Pure: no I/O. The fetching half is content-status-store.ts.
 */

export type VideoState = "public" | "unlisted" | "private" | "upcoming" | "unknown";

export interface WatchPageFacts {
  state: VideoState;
  /** YYYY-MM-DD YouTube made it public (its own publishDate). */
  publishedOn: string | null;
  lengthSeconds: number | null;
  title: string | null;
  description: string | null;
}

function jsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/** Read the facts that matter out of a watch page's embedded player response. */
export function parseWatchPage(html: string): WatchPageFacts {
  const status = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1] ?? null;
  const unlisted = html.match(/"isUnlisted":(true|false)/)?.[1] ?? null;
  const upcoming = /"isUpcoming":true/.test(html) || /"upcomingEventData":\{/.test(html);
  const publish = html.match(/"publishDate":"(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const len = html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? null;
  const title = html.match(/"videoDetails":\{"videoId":"[^"]+","title":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;
  const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;

  let state: VideoState = "unknown";
  if (status === "LOGIN_REQUIRED" || status === "ERROR" || status === "UNPLAYABLE") state = "private";
  else if (status === "LIVE_STREAM_OFFLINE" || upcoming) state = "upcoming";
  else if (status === "OK" && unlisted === "true") state = "unlisted";
  else if (status === "OK" && unlisted === "false") state = "public";

  return {
    state,
    publishedOn: publish,
    lengthSeconds: len ? Number(len) : null,
    title: title ? jsonString(title) : null,
    description: desc ? jsonString(desc) : null,
  };
}

export interface FeedEntry {
  videoId: string;
  publishedOn: string;
  title: string;
  description: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The entries in a channel's videos.xml feed (public uploads, newest first). */
export function parseChannelFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const videoId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const published = e.match(/<published>(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!videoId || !published) continue;
    out.push({
      videoId,
      publishedOn: published,
      title: decodeXml(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").trim(),
      description: decodeXml(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? "").trim(),
    });
  }
  return out;
}

/** Shorts and clips are not what a follow-up should point at. */
export const MIN_LONG_VIDEO_SECONDS = 180;

/** A YouTube status this old no longer counts — fail closed. */
export const STATUS_MAX_AGE_DAYS = 3;

/**
 * The line an auto-discovered video is sent with: its own title, cleaned —
 * never her description text, which carries calls to action, hashtags and
 * links that must not land in a follow-up.
 */
export function lineFromTitle(title: string): string {
  const t = title.split("|")[0].replace(/#\S+/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

/** youtu.be id of a URL, or null. */
export function youtubeIdOf(url: string): string | null {
  return (
    url.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1] ??
    url.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,})/)?.[1] ??
    null
  );
}
