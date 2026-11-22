/**
 * Shown on a course link that has been switched off (refunded). Polite and
 * final: no sales line, no "link broken", nothing to tap but a contact.
 */
import { SequoyaFonts, SequoyaRingMark } from "@/components/sequoya/sequoya-brand";

export function CourseEndedScreen() {
  return (
    <div className="ochre-app sequoya">
      <SequoyaFonts />
      <div className="app">
        <div className="token-screen cg-gate" style={{ position: "relative", height: "100dvh" }}>
          <span className="big-mark">
            <SequoyaRingMark size={56} />
          </span>
          <div className="cg-gate-body">
            <h1 className="cg-gate-h">This course has ended</h1>
            <p>Your access to Calm Gut has been closed, and no more reminders will come from this app.</p>
            <p>
              If you think this is a mistake, write to <b>hello@theochretree.com</b>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
