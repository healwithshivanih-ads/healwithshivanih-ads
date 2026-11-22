import { describe, expect, it } from "vitest";
import {
  audioLinkFor,
  courseAudioMode,
  isValidAudioKey,
  localAudioPath,
  makeTicket,
  parseRange,
  presignS3Get,
  readTicket,
} from "./course-audio";

describe("S3 SigV4 presign", () => {
  it("matches the AWS documentation's worked example", () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presignS3Get({
      bucket: "examplebucket",
      region: "us-east-1",
      keyId: "AKIAIOSFODNN7EXAMPLE",
      secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      key: "test.txt",
      expiresSec: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
      host: "examplebucket.s3.amazonaws.com",
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("uses the regional virtual-host by default and caps expiry at 7 days", () => {
    const url = presignS3Get({
      bucket: "ochre-course-audio",
      region: "ap-south-1",
      keyId: "K",
      secret: "S",
      key: "calm-gut/d1/s1-music.m4a",
      expiresSec: 99_999_999,
    });
    expect(url.startsWith("https://ochre-course-audio.s3.ap-south-1.amazonaws.com/calm-gut/d1/s1-music.m4a?")).toBe(true);
    expect(url).toContain("X-Amz-Expires=604800");
  });
});

describe("storage mode", () => {
  it("is off with nothing configured, so the app says audio isn't ready", () => {
    expect(courseAudioMode({})).toBe("off");
    expect(audioLinkFor("calm-gut/d1/s1-music.m4a", "gd-1", { env: {} })).toBeNull();
  });
  it("prefers S3 when fully configured", () => {
    const env = { COURSE_AUDIO_S3_BUCKET: "b", COURSE_AUDIO_S3_KEY_ID: "k", COURSE_AUDIO_S3_SECRET: "s", COURSE_AUDIO_DIR: "/x", COURSE_AUDIO_SECRET: "z" };
    expect(courseAudioMode(env)).toBe("s3");
    const link = audioLinkFor("calm-gut/d1/s1-music.m4a", "gd-1", { env, now: new Date("2026-12-08T10:00:00Z") })!;
    expect(link.mode).toBe("s3");
    expect(link.url).toContain("b.s3.ap-south-1.amazonaws.com");
    expect(link.expiresAt).toBe("2026-12-08T16:00:00.000Z");
  });
  it("local mode needs a signing secret", () => {
    expect(courseAudioMode({ COURSE_AUDIO_DIR: "/x" })).toBe("off");
    expect(courseAudioMode({ COURSE_AUDIO_DIR: "/x", COURSE_AUDIO_SECRET: "z" })).toBe("local");
    const link = audioLinkFor("calm-gut/d1/s1-music.m4a", "gd-1", { env: { COURSE_AUDIO_DIR: "/x", COURSE_AUDIO_SECRET: "z" } })!;
    expect(link.url.startsWith("/api/app-course/stream/")).toBe(true);
    // The link carries no app token.
    expect(link.url).not.toMatch(/token/i);
  });
  it("production (Fly) is S3 only: local disk is refused there unless allowed on purpose", () => {
    const local = { COURSE_AUDIO_DIR: "/x", COURSE_AUDIO_SECRET: "z" };
    expect(courseAudioMode({ ...local, FLY_INTAKE_ONLY: "1" })).toBe("off");
    expect(courseAudioMode({ ...local, FLY_INTAKE_ONLY: "1", COURSE_AUDIO_ALLOW_LOCAL: "1" })).toBe("local");
    expect(
      courseAudioMode({ ...local, FLY_INTAKE_ONLY: "1", COURSE_AUDIO_S3_BUCKET: "b", COURSE_AUDIO_S3_KEY_ID: "k", COURSE_AUDIO_S3_SECRET: "s" }),
    ).toBe("s3");
  });
  it("never signs a key outside the course layout", () => {
    expect(isValidAudioKey("calm-gut/d1/s1-music.m4a")).toBe(true);
    expect(isValidAudioKey("../clients/cl-001/client.yaml")).toBe(false);
    expect(isValidAudioKey("calm-gut/d1/s1-music.mp3")).toBe(false);
    expect(audioLinkFor("../etc/passwd", "gd-1", { env: { COURSE_AUDIO_DIR: "/x", COURSE_AUDIO_SECRET: "z" } })).toBeNull();
  });
});

describe("local tickets", () => {
  const key = "calm-gut/d1/s2-voice.m4a";
  it("round-trips while valid", () => {
    const t = makeTicket(key, "gd-abc", 2_000, "secret");
    expect(readTicket(t, 1_999, "secret")).toEqual({ key, subscriberId: "gd-abc" });
  });
  it("dies when expired, tampered with, or signed with another secret", () => {
    const t = makeTicket(key, "gd-abc", 2_000, "secret");
    expect(readTicket(t, 2_001, "secret")).toBeNull();
    expect(readTicket(t, 1_000, "other")).toBeNull();
    const [p, m] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "calm-gut/d1/s8-voice.m4a", e: 9_999_999_999, s: "gd-abc" })).toString("base64url");
    expect(readTicket(`${forged}.${m}`, 1_000, "secret")).toBeNull();
    expect(readTicket(`${p}.${m}.x`, 1_000, "secret")).toBeNull();
    expect(readTicket("", 1_000, "secret")).toBeNull();
  });
  it("resolves files inside COURSE_AUDIO_DIR only", () => {
    expect(localAudioPath(key, { COURSE_AUDIO_DIR: "/srv/audio" })).toBe("/srv/audio/calm-gut/d1/s2-voice.m4a");
    expect(localAudioPath("calm-gut/../../x-music.m4a", { COURSE_AUDIO_DIR: "/srv/audio" })).toBeNull();
    expect(localAudioPath(key, {})).toBeNull();
  });
});

describe("Range parsing (iOS needs it)", () => {
  it("handles the shapes Safari and Chrome send", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=500-99999", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("refuses what it can't satisfy", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange("bytes=5-2", 1000)).toBe("invalid");
    expect(parseRange("bytes=-", 1000)).toBe("invalid");
    expect(parseRange("items=0-1", 1000)).toBe("invalid");
  });
});
