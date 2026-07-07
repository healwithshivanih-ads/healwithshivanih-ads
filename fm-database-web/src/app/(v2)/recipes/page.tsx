import { FmAppShell, FmPageHeader } from "@/components/fm";
import { listRecipeImageStatuses } from "./actions";
import { listRecipeCandidatesAction } from "@/lib/server-actions/recipe-inbox";
import RecipeImagesClient from "./recipes-client";
import RecipeInboxClient from "./recipe-inbox-client";

// Candidates arrive OUT-OF-BAND (WhatsApp webhook via Mutagen, batch drafts)
// with no revalidatePath — a statically prerendered page would freeze at
// build-time state and new forwards would never appear. Always render live.
export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const [recipes, candidates] = await Promise.all([
    listRecipeImageStatuses(),
    listRecipeCandidatesAction(),
  ]);
  const missing = recipes.filter((r) => !r.hasWebImage);
  const done = recipes.filter((r) => r.hasWebImage);
  const pending = candidates.filter((c) => c.status === "new" || c.status === "parsed");
  return (
    <FmAppShell activeNavId="recipes" crumbs={[{ label: "Recipes" }]}>
      <FmPageHeader
        title="Recipes"
        subtitle={`${recipes.length} recipes in the library · ${pending.length} inbox candidate${pending.length === 1 ? "" : "s"} to review · ${missing.length} missing an image`}
      />
      <div className="px-6 pb-10 max-w-4xl space-y-8">
        <RecipeInboxClient initial={candidates} />
        <RecipeImagesClient missing={missing} done={done} />
      </div>
    </FmAppShell>
  );
}
