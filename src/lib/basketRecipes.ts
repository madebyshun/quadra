/** Saved basket recipes contain only a name and target weights, never balances or wallet data. */
export type Recipe = { readonly name: string; readonly picks: readonly (readonly [string, number])[] };
export const RECIPES_KEY = "quadra.baskets.v1";

export function parseRecipe(value: unknown): Recipe | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as { name?: unknown; picks?: unknown };
  if (typeof r.name !== "string" || r.name.trim().length === 0 || r.name.length > 48 || !Array.isArray(r.picks) || r.picks.length === 0 || r.picks.length > 10) return null;
  const picks: [string, number][] = [];
  const seen = new Set<string>();
  for (const p of r.picks) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "string" || !/^[A-Za-z0-9.]{1,16}$/.test(p[0]) || !Number.isInteger(p[1]) || p[1] < 1 || p[1] > 100) return null;
    const symbol = p[0].toUpperCase();
    if (seen.has(symbol)) return null;
    seen.add(symbol);
    picks.push([symbol, p[1] as number]);
  }
  return picks.reduce((sum, p) => sum + p[1], 0) === 100 ? { name: r.name.trim(), picks } : null;
}

export function loadRecipes(): Recipe[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECIPES_KEY) ?? "[]");
    return Array.isArray(list) ? list.flatMap((v) => { const r = parseRecipe(v); return r ? [r] : []; }).slice(0, 20) : [];
  } catch { return []; }
}

export function saveRecipe(recipe: Recipe): Recipe[] {
  const recipes = [recipe, ...loadRecipes().filter((r) => r.name.toLowerCase() !== recipe.name.toLowerCase())].slice(0, 20);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  return recipes;
}

export function removeRecipe(name: string): Recipe[] {
  const recipes = loadRecipes().filter((r) => r.name !== name);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  return recipes;
}

export function recipeLink(recipe: Recipe): string {
  return `${window.location.origin}/?do=basket&b=${recipe.picks.map(([symbol, weight]) => `${symbol}:${weight}`).join(",")}&name=${encodeURIComponent(recipe.name)}`;
}

export function sharedRecipe(search: string): Recipe | null {
  const params = new URLSearchParams(search);
  const compact = params.get("b");
  const raw = params.get("basket");
  if (compact === null && raw === null) return null;
  const recipe = parseRecipe(compact !== null ? {
    name: params.get("name") ?? "Shared basket",
    picks: compact.split(",").map((pick) => pick.split(":").map((value, i) => i === 0 ? value : Number(value))),
  } : JSON.parse(raw!) as unknown);
  if (!recipe) throw new Error("This basket link is invalid. Choose a preset or build your own.");
  return recipe;
}
