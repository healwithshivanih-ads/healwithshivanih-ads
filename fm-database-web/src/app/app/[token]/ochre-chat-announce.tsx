"use client";

/**
 * One-time announcement: the conversation now lives in the app.
 *
 * WHY THIS EXISTS AT ALL. The in-app chat has been live for every client for
 * days and exactly one of seventeen has used it — not because it is hard to
 * find, but because nobody has been told it is there. WhatsApp is the habit,
 * and a habit does not change because a feature shipped. WhatsApp becomes
 * paid per message on 1 October, so the entire saving turns on clients
 * moving across, and no further building moves that number. Telling them
 * does.
 *
 * Shown once, dismissible, and it never nags: tapping through counts as
 * dismissed, because someone who has opened Messages has been told. It also
 * self-retires — anyone who has already sent a message never sees it, since
 * announcing something they are already doing reads as noise and teaches
 * them to ignore the next card that matters.
 *
 * Deliberately NOT a demand to abandon WhatsApp. She still replies there;
 * the client loses nothing by ignoring this.
 */
import { useEffect, useState } from "react";
import { Icon } from "./ochre-context";

const DISMISS_KEY = "ochre.chat.announced";

export function ChatAnnounce({
  firstName,
  hasChatted,
  onOpen,
}: {
  firstName: string;
  /** Already messaging in the app — nothing to announce. */
  hasChatted: boolean;
  onOpen: () => void;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (hasChatted) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // Storage blocked: showing it every visit is worse than not at all,
      // because a card that will not stay dismissed is the definition of a
      // nag. Stay quiet.
      return;
    }
    setShow(true);
  }, [hasChatted]);

  if (!show) return null;

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* already handled above */
    }
  };

  return (
    <div className="card announce-card">
      <div className="announce-row">
        <span className="announce-ic">
          <Icon name="coach" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="announce-h">You can message {firstName} here now</div>
          <p className="announce-p">
            Write to {firstName} in the app instead of WhatsApp — she sees it
            the same way, and it keeps everything in one place alongside your
            plan. WhatsApp still works if you prefer it.
          </p>
          <div className="announce-actions">
            <button
              type="button"
              className="announce-go"
              onClick={() => {
                close();
                onOpen();
              }}
            >
              Open Messages
            </button>
            <button type="button" className="announce-later" onClick={close}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
