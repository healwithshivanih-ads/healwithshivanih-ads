/**
 * Meals — the review queue (docs/MEAL_PHOTO_CHECK_SPEC.md, phase 2a).
 *
 * Server-rendered list, interactive controls in the client component. The
 * empty state does real work here: the queue will be empty for a while, and
 * an empty screen with no explanation reads as broken rather than as "no
 * client has sent a photo yet".
 */
import { loadMealQueue } from "@/lib/fmdb/meal-queue";
import { MealsList } from "./meals-list";

export const dynamic = "force-dynamic";

export default async function MealsPage() {
  const rows = loadMealQueue();
  return (
    <div className="m-page">
      <div className="m-pagehead">
        <h1>Meals</h1>
        <p className="m-subtle">
          Every photo is checked automatically. This opens on the ones that
          need you — anything flagged, or a meal that wasn&apos;t on the plan.
        </p>
      </div>
      <MealsList initial={rows} />
    </div>
  );
}
