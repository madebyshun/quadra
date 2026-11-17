import { useState } from "react";
import { PRESETS } from "@/lib/basket";

/** Preview composition before changing a basket. A recipe is not a vault or index token. */
export function BasketLibrary({ disabled, onChoose }: { disabled: boolean; onChoose: (picks: readonly (readonly [string, number])[], name: string) => void }) {
  const [selected, setSelected] = useState(0);
  const preset = PRESETS[selected]!;
  return <details className="group basket-library" open>
    <summary>baskets / explore</summary>
    <p className="dim">Compare target allocations, then open one in the editor. Each asset is bought into your own wallet on Base.</p>
    <div className="row" role="group" aria-label="Explore basket recipes">{PRESETS.map((p,i)=><button className="chip" type="button" key={p.name} aria-pressed={selected===i} onClick={()=>setSelected(i)}>{p.name}</button>)}</div>
    <h3>{preset.name}</h3>
    <p>{preset.picks.length} assets / fixed target weights / no basket token</p>
    <ul className="basket-library__weights" aria-label="Recipe composition">{preset.picks.map(([symbol,weight])=><li key={symbol}><span>{symbol}</span><meter min={0} max={100} value={weight} aria-label={`${symbol} target weight`}/><span>{weight}%</span></li>)}</ul>
    <button type="button" className="gel gel--quiet" disabled={disabled} onClick={()=>onChoose(preset.picks,preset.name)}>use this allocation</button>
    <p className="dim">No quote or transaction is requested by this preview. Route fees, price impact and wallet confirmations are reviewed after you enter an amount. No fixed-price redemption or round-trip cost is promised.</p>
  </details>;
}
