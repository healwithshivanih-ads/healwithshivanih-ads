import { describe, expect, it } from "vitest";
import { optOutPhrase, replyBody } from "./email-replies";

const quoted = (reply: string) =>
  `${reply}\n\nOn Tue, 20 Oct 2026 at 10:00, Shivani Hari <shivani@example.com> wrote:\n> Hi Asha,\n> If you'd rather not get notes like this, just reply "no more" and I'll stop.\n`;

describe("replyBody", () => {
  it("keeps only what they typed above the quoted email", () => {
    expect(replyBody(quoted("No more please"))).toBe("No more please");
  });
  it("handles the Gmail 'On … wrote:' split over two lines", () => {
    const t = "Thanks!\n\nOn Tue, 20 Oct 2026 at 10:00, Shivani Hari <s@x.com>\nwrote:\n> no more";
    expect(replyBody(t)).toBe("Thanks!");
  });
  it("drops Outlook headers and phone signatures", () => {
    expect(replyBody("Sounds good\nSent from my iPhone\n")).toBe("Sounds good");
    expect(replyBody("ok\n-----Original Message-----\nFrom: x\nno more")).toBe("ok");
  });
});

describe("optOutPhrase — catches the opt-outs", () => {
  it.each([
    "No more",
    "no more please",
    "No more 🙏",
    "Stop",
    "unsubscribe",
    "Please unsubscribe me from these",
    "Please stop sending these emails",
    "Don't email me again",
    "Remove me from your list",
    "No more emails please, thank you",
    "Not interested",
    "not interested, thanks",
  ])("%s", (t) => {
    expect(optOutPhrase(replyBody(quoted(t)))).not.toBeNull();
  });
});

describe("optOutPhrase — does NOT catch good news or real questions", () => {
  it.each([
    "No more bloating since I started the seeds!",
    "I have no more questions, I'll book the session",
    "Thank you, this was so helpful",
    "Can you send me the link to book?",
    "I'm not interested in going on medication, which is why I came to you. Could we talk about what the Foundation session would look at for my thyroid?",
    "",
  ])("%s", (t) => {
    expect(optOutPhrase(replyBody(quoted(t)))).toBeNull();
  });

  it("ignores the opt-out line quoted from our own email", () => {
    // Our note says 'reply "no more"' — that text sits in the quote, not the reply.
    expect(optOutPhrase(replyBody(quoted("Lovely video, thank you")))).toBeNull();
  });
});
