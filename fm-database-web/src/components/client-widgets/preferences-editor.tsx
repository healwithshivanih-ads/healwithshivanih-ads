"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateClientPreferences } from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
  initial: {
    dietary_preference?: string;
    foods_to_avoid?: string;
    reported_triggers?: string;
    non_negotiables?: string;
    city?: string;
    country?: string;
  };
}

export function PreferencesEditor({ clientId, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [dietaryPreference, setDietaryPreference] = useState(
    initial.dietary_preference ?? ""
  );
  const [foodsToAvoid, setFoodsToAvoid] = useState(
    initial.foods_to_avoid ?? ""
  );
  const [reportedTriggers, setReportedTriggers] = useState(
    initial.reported_triggers ?? ""
  );
  const [nonNegotiables, setNonNegotiables] = useState(
    initial.non_negotiables ?? ""
  );
  const [city, setCity] = useState(initial.city ?? "");
  const [country, setCountry] = useState(initial.country ?? "");

  const hasData =
    initial.dietary_preference ||
    initial.foods_to_avoid ||
    initial.reported_triggers ||
    initial.non_negotiables ||
    initial.city ||
    initial.country;

  const save = () => {
    startTransition(async () => {
      const res = await updateClientPreferences({
        client_id: clientId,
        dietary_preference: dietaryPreference,
        foods_to_avoid: foodsToAvoid,
        reported_triggers: reportedTriggers,
        non_negotiables: nonNegotiables,
        city,
        country,
      });
      if (res.ok) {
        toast.success("Preferences saved");
        setOpen(false);
      } else {
        toast.error(res.error ?? "Save failed");
      }
    });
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">🥗 Food &amp; lifestyle preferences</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Cancel" : hasData ? "Edit" : "Add"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        {!open && (
          <>
            {(initial.city || initial.country) && (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Location: </span>
                {[initial.city, initial.country].filter(Boolean).join(", ")}
              </div>
            )}
            {initial.dietary_preference ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Diet: </span>
                {initial.dietary_preference}
              </div>
            ) : null}
            {initial.foods_to_avoid ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Won&apos;t eat: </span>
                <span className="text-muted-foreground">{initial.foods_to_avoid}</span>
              </div>
            ) : null}
            {initial.reported_triggers ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">⚠ Reported triggers: </span>
                <span className="text-amber-700 font-medium">{initial.reported_triggers}</span>
              </div>
            ) : null}
            {initial.non_negotiables ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Won&apos;t give up: </span>
                <span className="text-muted-foreground">{initial.non_negotiables}</span>
              </div>
            ) : null}
            {!hasData && (
              <p className="text-xs text-muted-foreground">
                No preferences on file — click Add to set them. These are used when generating the client letter.
              </p>
            )}
          </>
        )}

        {open && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mumbai"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Country</label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. India"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Used to suggest seasonal produce and region-appropriate recipes in the meal plan.
            </p>

            <div>
              <label className="text-xs font-medium block mb-1">Dietary preference</label>
              <select
                value={dietaryPreference}
                onChange={(e) => setDietaryPreference(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— select —</option>
                <option value="Vegetarian">Vegetarian</option>
                <option value="Vegetarian Jain">Vegetarian Jain</option>
                <option value="Eggetarian">Eggetarian (veg + eggs)</option>
                <option value="Non-vegetarian">Non-vegetarian</option>
                <option value="Vegan">Vegan</option>
                <option value="Pescatarian">Pescatarian (fish, no meat)</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Foods they will NOT eat</label>
              <textarea
                value={foodsToAvoid}
                onChange={(e) => setFoodsToAvoid(e.target.value)}
                rows={2}
                placeholder="e.g. brinjal, bitter gourd, raw onion, mushrooms"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                ⚠ Reported triggers / intolerances
              </label>
              <textarea
                value={reportedTriggers}
                onChange={(e) => setReportedTriggers(e.target.value)}
                rows={2}
                placeholder="e.g. wheat causes bloating, dairy causes acne, coffee causes palpitations"
                className="w-full rounded-md border border-amber-300 bg-amber-50/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Foods / substances client has personally experienced reactions to. These are EXCLUDED from all future meal plans.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                Non-negotiables (won&apos;t give up)
              </label>
              <textarea
                value={nonNegotiables}
                onChange={(e) => setNonNegotiables(e.target.value)}
                rows={2}
                placeholder="e.g. morning chai with milk and sugar, rice at dinner"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
