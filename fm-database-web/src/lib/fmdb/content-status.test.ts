import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lineFromTitle, parseChannelFeed, parseWatchPage, youtubeIdOf } from "./content-status";

const fx = (f: string) => fs.readFileSync(path.join(__dirname, "__fixtures__", f), "utf-8");

describe("parseWatchPage — cut from real pages, 21 Oct 2026", () => {
  it("reads a public video (protein, live 4 Oct)", () => {
    const f = parseWatchPage(fx("yt-watch-public.html.txt"));
    expect(f.state).toBe("public");
    expect(f.publishedOn).toBe("2026-10-04");
    expect(f.title).toMatch(/^Your Dal Has Less Protein Than One Egg/);
  });

  it("reads a scheduled (private) video as private (Diwali, premiering later)", () => {
    const f = parseWatchPage(fx("yt-watch-private.html.txt"));
    expect(f.state).toBe("private");
    expect(f.publishedOn).toBeNull();
  });

  it("treats an unlisted video as not public", () => {
    expect(parseWatchPage('"playabilityStatus":{"status":"OK" ... "isUnlisted":true').state).toBe("unlisted");
  });

  it("treats a premiere that is scheduled publicly as upcoming", () => {
    expect(parseWatchPage('"playabilityStatus":{"status":"OK" "isUnlisted":false "isUpcoming":true').state).toBe("upcoming");
    expect(parseWatchPage('"playabilityStatus":{"status":"LIVE_STREAM_OFFLINE"').state).toBe("upcoming");
  });

  it("is unknown for a consent wall or garbage — never public by default", () => {
    expect(parseWatchPage("<html>Before you continue to YouTube</html>").state).toBe("unknown");
  });
});

describe("parseChannelFeed — real feed, 21 Oct 2026", () => {
  it("lists public uploads with id, date and title", () => {
    const e = parseChannelFeed(fx("yt-channel-feed.xml"));
    expect(e.length).toBe(5);
    expect(e.every((x) => /^[A-Za-z0-9_-]{11}$/.test(x.videoId))).toBe(true);
    const hrt = e.find((x) => x.videoId === "bxEvoBq5wl4");
    expect(hrt?.publishedOn).toBe("2026-10-18");
    expect(hrt?.title).toMatch(/Hormone Therapy Warning/);
  });
});

describe("lineFromTitle", () => {
  it("drops the SEO tail after a pipe and adds a full stop", () => {
    expect(lineFromTitle("Belly Fat After 40? It's Not Just Calories | Menopause Belly Fat")).toBe(
      "Belly Fat After 40? It's Not Just Calories.",
    );
    expect(lineFromTitle("Perimenopause or losing my mind?")).toBe("Perimenopause or losing my mind?");
    expect(lineFromTitle("Your roti vs your dal #shorts")).toBe("Your roti vs your dal.");
  });
});

describe("youtubeIdOf", () => {
  it("reads both URL shapes", () => {
    expect(youtubeIdOf("https://youtu.be/OI-nOJ8vzRg")).toBe("OI-nOJ8vzRg");
    expect(youtubeIdOf("https://www.youtube.com/watch?v=OI-nOJ8vzRg")).toBe("OI-nOJ8vzRg");
    expect(youtubeIdOf("https://grow.theochretree.com/x.html")).toBeNull();
  });
});
