"use client";

/**
 * Today's screens, hosted inside the new front (build plan step 4: "re-home
 * the existing screens, restyle, do not rewrite").
 *
 * The week's menu, the shopping list, the weekly check-in, booking and paying
 * for a test, and the movement session are each TODAY'S component — the same
 * data, routes and payment flow — opened full-screen over the new shell. None
 * of ordering, booking, paying or sending is new code, so none of it can newly
 * break. They keep today's look (app.css under `.ochre-app`); bringing them
 * into the Sequoya look is polish for step 6.
 */

import type { ReactNode } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { CheckinScreen } from "./ochre-checkin";
import { ExerciseOverlay } from "./ochre-exercise";
import { LabsOverlay } from "./ochre-labs";
import { GroceryOverlay, WeekMenuSection } from "./ochre-week-menu";
import { OchreContext } from "./ochre-context";
import { SqIcon } from "./sq-ui";

export type HostedId = "menu" | "grocery" | "checkin" | "labs" | "move";

export const HOSTED_TITLES: Record<HostedId, string> = {
  menu: "This week's menu",
  grocery: "Shopping list",
  checkin: "Your check-in",
  labs: "Tests and results",
  move: "Movement",
};

/** Which hosted screens this client has something behind. */
export function hostedAvailable(
  data: Pick<ClientAppData, "weekMenus" | "grocery" | "exerciseSessions">,
): Set<HostedId> {
  const s = new Set<HostedId>(["checkin", "labs"]);
  if (data.weekMenus.length > 0) s.add("menu");
  if (data.grocery && data.grocery.weeks.some((w) => w.items.length > 0))
    s.add("grocery");
  if (data.exerciseSessions.length > 0) s.add("move");
  return s;
}

export function SqHost({
  id,
  data,
  checkinSent,
  onCheckinSent,
  openHosted,
  onClose,
}: {
  id: HostedId;
  data: ClientAppData;
  checkinSent: boolean;
  onCheckinSent: () => void;
  /** from the menu, "Shopping list" opens the list in place of the menu */
  openHosted: (id: HostedId) => void;
  onClose: () => void;
}) {
  let overlay: ReactNode = null;
  let screen: ReactNode = null;
  if (id === "grocery") overlay = <GroceryOverlay onClose={onClose} />;
  else if (id === "labs") overlay = <LabsOverlay onClose={onClose} numbersHeld={!data.sq?.results} />;
  else if (id === "move" && data.exerciseSessions[0])
    overlay = (
      <ExerciseOverlay
        session={data.exerciseSessions[0]}
        token={data.token}
        onClose={onClose}
      />
    );
  else if (id === "checkin")
    screen = (
      <CheckinScreen
        submitted={checkinSent}
        onSubmit={onCheckinSent}
        onClose={onClose}
      />
    );
  else if (id === "menu")
    screen = <WeekMenuSection openGrocery={() => openHosted("grocery")} />;

  // The new front never prints the coach's name. Today's screens print the
  // coach's first name in a few lines ("tell Shivani how you're doing"), so
  // they are handed a copy of the data in which the name is "Coach".
  const hostedData: ClientAppData = {
    ...data,
    coach: { ...data.coach, name: "Coach", initials: "C" },
  };
  return (
    <OchreContext.Provider value={hostedData}>
      <div
        className="sq-host"
        role="dialog"
        aria-modal="true"
        aria-label={HOSTED_TITLES[id]}
      >
        <div className="ochre-app sequoya sq-host-app">
          {overlay ? (
            <div className="overlay show">{overlay}</div>
          ) : (
            <>
              {/* Today's check-in draws its own header and Close. */}
              {id !== "checkin" && (
                <div className="sq-host-bar">
                  <h2>{HOSTED_TITLES[id]}</h2>
                  <button
                    type="button"
                    className="sq-x"
                    aria-label="Close"
                    onClick={onClose}
                  >
                    <SqIcon name="x" />
                  </button>
                </div>
              )}
              <main className="screen-scroll">
                <div className={id === "checkin" ? undefined : "screen-pad"}>
                  {screen}
                </div>
              </main>
            </>
          )}
        </div>
      </div>
    </OchreContext.Provider>
  );
}
