import { useEffect, useState } from "react";
import { loadRecipes, parseRecipe, recipeLink, removeRecipe, saveRecipe, sharedRecipe, type Recipe } from "@/lib/basketRecipes";
import { messageOf } from "@/lib/errors";
import { copyText } from "@/features/panels/ContractAddress";
import { Gel } from "@/ui/Gel";

export function BasketRecipes({ rows, name, setName, onLoad, disabled }: {
  rows: readonly { readonly symbol: string; readonly weight: string }[]; name: string;
  setName: (name: string) => void; onLoad: (recipe: Recipe) => void; disabled: boolean;
}) {
  const [saved, setSaved] = useState(loadRecipes);
  const [note, setNote] = useState<string | null>(null);
  const recipe = parseRecipe({ name, picks: rows.map((r) => [r.symbol.trim(), Number(r.weight)]) });
  useEffect(() => {
    try { const r = sharedRecipe(window.location.search); if (r) { onLoad(r); setNote("Shared basket loaded. Review its assets and enter your own amount."); } }
    catch (e) { setNote(messageOf(e)); }
  }, []);
  const save = () => {
    try { setSaved(saveRecipe(recipe!)); setNote("Saved in this browser. Your wallet and balances are not saved or shared."); }
    catch { setNote("This browser could not save the basket. Use its share link instead."); }
  };
  const remove = (name: string) => {
    try { setSaved(removeRecipe(name)); setNote("Saved basket removed."); }
    catch { setNote("This browser could not remove the saved basket."); }
  };
  return <div className="stack basket__recipes">
    <label className="group__row"><span>Name</span><input className="field" aria-label="Basket name" maxLength={48} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} /></label>
    <div className="row">
      <Gel quiet disabled={disabled || recipe === null} onClick={save}>Save basket</Gel>
      <Gel quiet disabled={disabled || recipe === null} onClick={() => void copyText(recipeLink(recipe!)).then((ok) => setNote(ok ? "Basket link copied — it shares only the name and target weights." : "Could not copy. Open the basket link below and copy its address."))}>Copy basket link</Gel>
      {recipe ? <a className="gel gel--quiet" href={recipeLink(recipe)} target="_blank" rel="noopener noreferrer">Open basket link</a> : null}
    </div>
    {saved.length > 0 ? <ul className="basket__saved" aria-label="Saved baskets">{saved.map((r) => <li key={r.name} className="row"><button className="chip" disabled={disabled} onClick={() => { onLoad(r); setNote("Saved basket loaded. Enter an amount to get fresh quotes."); }}>{r.name}</button><button className="chip" disabled={disabled} aria-label={`Delete saved basket ${r.name}`} onClick={() => remove(r.name)}>×</button></li>)}</ul> : null}
    {note ? <p role="status" className="dim">{note}</p> : null}
  </div>;
}
