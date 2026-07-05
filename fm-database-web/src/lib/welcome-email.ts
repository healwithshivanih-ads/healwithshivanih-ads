/**
 * welcome-email.ts — the static, no-AI welcome email (replaces the retired
 * Sonnet "welcome letter"). Email-safe: inline styles, no scripts, no
 * fixed/scroll. Screenshots ship as CID attachments (Gmail blocks data-URIs),
 * so the body references them as <img src="cid:…">; the six files live in
 * public/welcome/ and the sender attaches them (see WELCOME_SHOTS).
 *
 * Two merge fields only: the client's first name and their /app link.
 */

const INK = "#33302A", SAGE = "#3E5641", SAGES = "#5B7360", OCHRE = "#B85C3E",
  PAPER = "#F7F4EC", HAIR = "#DED8C9";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

/** cid ⇆ file in public/welcome/. The sender reads each file and attaches it. */
export const WELCOME_SHOTS: { cid: string; file: string }[] = [
  { cid: "today", file: "today.jpg" },
  { cid: "plan", file: "plan.jpg" },
  { cid: "progress", file: "progress.jpg" },
  { cid: "labs", file: "labs.jpg" },
  { cid: "coach", file: "coach.jpg" },
  { cid: "tree", file: "tree.jpg" },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const p = (t: string, mt = 14) =>
  `<p style="margin:${mt}px 0 0;font-family:${SERIF};font-size:16px;line-height:1.62;color:${INK};">${t}</p>`;
const h2 = (t: string, sz = 21) =>
  `<h2 style="margin:34px 0 6px;font-family:${SERIF};font-size:${sz}px;font-weight:normal;color:${SAGE};">${t}</h2>`;
const bullets = (items: string[]) =>
  `<ul style="margin:12px 0 0;padding-left:20px;">${items
    .map((i) => `<li style="margin:0 0 9px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${INK};">${i}</li>`)
    .join("")}</ul>`;
const img = (cid: string, alt: string) =>
  `<div style="text-align:center;margin:16px 0 4px;"><img src="cid:${cid}" alt="${alt}" width="238" style="width:238px;max-width:80%;height:auto;border-radius:16px;border:1px solid ${HAIR};box-shadow:0 10px 24px -14px rgba(62,86,65,.5);"></div>`;
const tab = (n: number, name: string, intro: string, items: string[], cid: string) =>
  `<div style="margin-top:30px;padding-top:22px;border-top:1px solid ${HAIR};">` +
  `<p style="margin:0;font-family:${SANS};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${OCHRE};">Tab ${n} of 5</p>` +
  `<h2 style="margin:3px 0 0;font-family:${SERIF};font-size:22px;font-weight:normal;color:${SAGE};">${name}</h2>` +
  p(intro, 8) + bullets(items) + img(cid, name) + `</div>`;

/** "welcome" = brand-new client (default; auto-fires on first publish).
 *  "transition" = existing mid-plan client whose plan used to arrive as
 *  messages and now lives in the app — a one-time "we've moved" note. */
export type WelcomeVariant = "welcome" | "transition";

export function welcomeEmailSubject(
  firstName: string,
  variant: WelcomeVariant = "welcome",
): string {
  return variant === "transition"
    ? `${firstName}, your plan has a new home 🌿`
    : `Welcome to your Ochre Tree, ${firstName} — your app guide`;
}

export function buildWelcomeEmailHtml(
  firstName: string,
  appUrl: string,
  variant: WelcomeVariant = "welcome",
): string {
  const fn = esc(firstName || "there");
  const url = esc(appUrl);
  const transition = variant === "transition";

  const eyebrow = transition ? "Your plan has moved &mdash; here's your guide" : "Your app, tab by tab";
  const heading = transition ? "Everything's now in one place" : "Welcome to your Ochre Tree";

  // The opening differs: new clients are being welcomed; mid-plan clients are
  // being told their existing plan has moved into an app they've not seen.
  const intro = transition
    ? p(`You're already underway on your plan &mdash; and from today, it lives somewhere far better than a string of messages. Everything I've been sending you &mdash; your meals, your supplements, your daily practices &mdash; is now in one place made just for you: <strong>your Ochre Tree</strong>. Nothing about your plan changes; it just finally has a proper home, and from here it grows with you &mdash; each week you check in, and it quietly adapts.`)
    : p(`I'm so glad to be walking this path with you. Everything we've mapped out — your plan, your meals, your supplements and your daily practices — now lives in one place made just for you: <strong>your Ochre Tree</strong>. Think of it as a living tree that grows with you: each week you check in, and your plan quietly adapts.`);

  // The "day one" box: for new clients it's the starting line; for mid-plan
  // clients it's the point we start measuring forward from.
  const baselineBadge = transition ? "Take five minutes today" : "Do this on day one";
  const baselineHeading = transition
    ? "Your symptom check &mdash; the mark we measure from"
    : "Your symptom baseline, in Progress";
  const baselineCopy = transition
    ? p(`Open the <strong>Progress</strong> tab and do your <strong>symptom check</strong> &mdash; even though you're already a few weeks in, this gives us a clear line to measure every future check-in against. About 5 minutes, once; every symptom starts at &ldquo;Never,&rdquo; so you only tap what applies. It re-opens <strong>every 3 weeks</strong>, and each time your number should fall.`, 8)
    : p(`Before anything else, open the <strong>Progress</strong> tab and do your <strong>symptom check</strong> &mdash; your starting line. About 5 minutes, once; every symptom starts at &ldquo;Never,&rdquo; so you only tap what applies. It re-opens <strong>every 3 weeks</strong>, and each time your number should fall.`, 8);

  return `<div style="margin:0;padding:22px 12px;background:${PAPER};font-family:${SERIF};">
<div style="max-width:600px;margin:0 auto;background:#FFFDF8;border:1px solid ${HAIR};border-radius:6px;padding:32px 30px 36px;">
  <div style="padding-bottom:16px;border-bottom:1px solid ${HAIR};">
    <span style="display:inline-block;width:26px;height:10px;background:#2D3047;border-radius:5px;vertical-align:middle;"></span>
    <span style="display:inline-block;width:10px;height:10px;background:#C08080;border-radius:50%;vertical-align:middle;margin:0 9px 0 3px;"></span>
    <span style="font-family:${SERIF};font-size:20px;color:#2D3047;vertical-align:middle;">The <em style="color:${OCHRE};">Ochre</em> Tree</span>
  </div>
  <p style="margin:26px 0 4px;font-family:${SANS};font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${OCHRE};">${eyebrow}</p>
  <h1 style="margin:0;font-family:${SERIF};font-size:32px;line-height:1.12;font-weight:normal;color:${SAGE};">${heading}</h1>
  ${p(`Dear ${fn},`, 18)}
  ${intro}
  ${h2("Open your app")}
  ${p("Tap the button below on your phone:", 8)}
  <div style="text-align:center;margin:16px 0 6px;">
    <a href="${url}" style="display:inline-block;font-family:${SANS};font-size:15px;font-weight:600;color:#fff;background:${OCHRE};text-decoration:none;padding:14px 26px;border-radius:12px;">Open your app &nbsp;&rarr;</a>
  </div>
  ${p(`Then choose <strong>&ldquo;Add to Home Screen&rdquo;</strong> from your browser menu &mdash; it will sit on your phone like any other app. No password, no download.`, 8)}
  <div style="margin-top:28px;border:1.5px solid ${OCHRE};border-radius:8px;background:#FBF3EE;padding:18px 20px;">
    <span style="display:inline-block;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:${OCHRE};border-radius:100px;padding:4px 11px;">${baselineBadge}</span>
    <h2 style="margin:12px 0 0;font-family:${SERIF};font-size:19px;font-weight:normal;color:${SAGE};">${baselineHeading}</h2>
    ${baselineCopy}
    ${img("progress", "Progress baseline")}
  </div>
  <h2 style="margin:38px 0 2px;font-family:${SERIF};font-size:24px;font-weight:normal;color:${SAGE};">The five tabs</h2>
  ${tab(1, "Today", "Your day, in order &mdash; with a card at the top that changes through the day.", ["<strong>Meals for today</strong>, each with a cook time &mdash; tap one for the <strong>full recipe</strong>.", "<strong>Supplements</strong> &mdash; tap to mark each as taken.", "A <strong>10-second daily log</strong> &mdash; how you felt + movement.", "Gentle <strong>Ayurveda</strong> nudges for your constitution."], "today")}
  ${tab(2, "Plan", "Your whole plan in one place, always up to date.", ["<strong>Two weeks of menus</strong> &mdash; every meal opens a full recipe.", "A <strong>fortnight shopping list</strong> &mdash; tick off and buy in one go.", "Don't fancy a dish? <strong>Swap it</strong> for the alternative.", "<strong>Supplements</strong> (dose + brand), <strong>practices</strong> with guides, and your 12-week phases."], "plan")}
  ${tab(3, "Progress", "Where you'll see the change, week by week.", ["Your <strong>symptom score</strong>, falling over time.", "Your <strong>tree</strong>, growing week by week.", "Your <strong>weight, measurements</strong> and wellbeing trend.", "<strong>Lab checkpoints</strong> &mdash; what to re-test, and when."], "progress")}
  ${tab(4, "Labs", "Your results in plain English.", ["Every marker against <strong>two ranges</strong> &mdash; standard normal <em>and</em> functional-optimal.", "Grouped by system, each with its date.", "The ones we're <strong>working on</strong> flagged."], "labs")}
  ${tab(5, "Coach", "Never stuck &mdash; two ways to get help.", ["<strong>Message me on WhatsApp</strong>, right from the app.", "<strong>Ask the co-pilot</strong> for instant everyday answers.", "Anything personal or medical goes <strong>straight to me</strong>."], "coach")}
  <div style="margin-top:32px;padding-top:22px;border-top:1px solid ${HAIR};">
    ${h2("Watch your tree grow")}
    ${p("Your Ochre Tree isn't just a name. On your Today and Progress screens, a real tree grows from <em>your</em> actions:", 8)}
    ${bullets(["<strong>Taller</strong> each week on plan.", "<strong>New leaves</strong> each day you log.", "A <strong>blossom</strong> when symptoms improve, <strong>fruit</strong> for each check-in, <strong>birds</strong> for a streak."])}
    ${img("tree", "The growing tree")}
  </div>
  <div style="margin-top:32px;padding-top:22px;border-top:1px solid ${HAIR};">
    ${h2("Your rhythm")}
    ${bullets(["<strong>Every day (~10 sec):</strong> a quick log on Today.", "<strong>Every week (~1 min):</strong> your check-in &mdash; it comes to me.", "<strong>Every 3 weeks:</strong> your symptom score, in Progress."])}
  </div>
  <div style="margin-top:32px;padding-top:22px;border-top:1px solid ${HAIR};">
    ${h2("Ready when you are")}
    <ol style="margin:12px 0 0;padding-left:20px;">
      <li style="margin:0 0 8px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${INK};">Open your link &middot; Add to Home Screen.</li>
      <li style="margin:0 0 8px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${INK};">Do your symptom ${transition ? "check" : "baseline"} in Progress.</li>
      <li style="margin:0 0 8px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${INK};">${transition ? "See today&rsquo;s meals in Today &amp; the fortnight in Plan." : "Glance at Today &amp; Plan."}</li>
      <li style="margin:0 0 8px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${INK};">${transition ? "Carry on with your plan, right where you left off." : "Start your supplements &mdash; pick your Day 1 when you're ready."}</li>
    </ol>
    ${p("Any question, message me from the Coach tab. I'm right here.")}
    <p style="margin:22px 0 0;font-family:${SERIF};font-size:16px;color:${INK};">With warmth,<br><span style="font-size:21px;color:${SAGE};">Shivani Hari</span><br><span style="font-family:${SANS};font-size:12px;color:${SAGES};">Your Functional Health Coach</span></p>
  </div>
</div>
</div>`;
}
