// Plain type module (NOT "use server") — shared by the ai-recipes server
// actions and the coach Plan-tab UI. Server-action files may only export async
// functions, so these interfaces live here.

/** One menu dish the client app serves from the AI-generated recipe pack. */
export interface AiRecipeFlag {
  dish: string; // the menu dish head component the recipe attaches to
  title: string; // the AI recipe title
  ingredients: string[];
  method: string[];
  alreadyInCatalogue: boolean; // a consistent catalogue recipe already covers it
}

export interface MenuAiRecipes {
  planSlug: string;
  count: number;
  recipes: AiRecipeFlag[];
}

export interface PromoteResult {
  ok: boolean;
  slug?: string;
  warnings?: string[];
  needsConfirm?: boolean;
  error?: string;
}
