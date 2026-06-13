import { FmAppShell, FmPageHeader } from "@/components/fm";
import { listRecipeImageStatuses } from "./actions";
import RecipeImagesClient from "./recipes-client";

export default async function RecipesPage() {
  const recipes = await listRecipeImageStatuses();
  const missing = recipes.filter((r) => !r.hasWebImage);
  const done = recipes.filter((r) => r.hasWebImage);
  return (
    <FmAppShell activeNavId="recipes" crumbs={[{ label: "Recipe images" }]}>
      <FmPageHeader
        title="Recipe Images"
        subtitle={`${done.length} with image · ${missing.length} missing · ${recipes.length} total recipes`}
      />
      <div className="px-6 pb-10 max-w-4xl">
        <RecipeImagesClient missing={missing} done={done} />
      </div>
    </FmAppShell>
  );
}
