import { useState } from "react";
import { BRAND } from "@/brand";
import { priceOf } from "@/config/api";
import { USDC } from "@/config/chain";
import { formatAmount } from "@/lib/amount";
import { API_PATH } from "@/server/apiPath";
import { SKILLS } from "@/skills";
import { Gel } from "@/ui/Gel";
import { QuadraSelect } from "@/ui/Select";
import type { WalletSession } from "@/ui/WalletProvider";
import type { Wallet } from "@/lib/wallet";
import { X402Url } from "@/features/panels/X402Url";
import type { Spending } from "@/features/panels/X402Parts";

/**
 * This app's own tools, paid over x402 — the first directory in this window since the owner made
 * the app a seller as well as a buyer (2026-09-30). Pick a skill, give its arguments, and the
 * URL of this app's own API is handed to the same any-URL flow every other x402 server goes
 * through: the price is READ from the 402 (never from `priceOf` — that number is shown only
 * as a guide), the payee is checked against this app's own fee address, the spending limits
 * apply, and the wallet signs.
 */

/** This app's API URL for one call: `<origin>/api/skills/<id>?arg=…`, arguments in order, blanks dropped from the end. */
export function ownApiUrl(origin: string, id: string, args: readonly string[]): string {
  const kept = args.map((a) => a.trim());
  while (kept.length > 0 && kept.at(-1) === "") kept.pop();
  const q = new URLSearchParams();
  for (const a of kept) q.append("arg", a);
  const query = q.toString();
  return `${origin}${API_PATH}/${id}${query ? `?${query}` : ""}`;
}

type Props = { wallet: Wallet; session: WalletSession; onConnect: () => void; spending: Spending };

export function X402Own(props: Props) {
  const [id, setId] = useState(SKILLS[0]!.id);
  const [args, setArgs] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const skill = SKILLS.find((s) => s.id === id)!;
  const missing = skill.args.find((a, i) => !a.optional && (args[i] ?? "").trim() === "");
  const previewUrl = ownApiUrl(location.origin, id, args);

  const pick = (next: string) => {
    setId(next);
    setArgs([]);
    setTarget(null);
    setCopied(false);
  };

  const copyUrl = () => {
    void navigator.clipboard?.writeText(previewUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <>
      <fieldset className="group x402__card">
        <legend>{BRAND.name}&apos;s own tools</legend>
        <div className="group__row">
          <span>Tool</span>
          <QuadraSelect
            ariaLabel={`${BRAND.name} tool`}
            value={id}
            onChange={pick}
            options={SKILLS.map((s) => ({ value: s.id, label: `${s.title} — ${s.summary}` }))}
          />
        </div>
        {skill.args.map((a, i) => (
          <label key={`${id}:${a.name}`} className="group__row">
            <span>{a.name}</span>
            <input
              className="field"
              aria-label={a.name}
              placeholder={a.optional ? `${a.hint} (optional)` : a.hint}
              spellCheck={false}
              value={args[i] ?? ""}
              onChange={(e) => {
                const next = [...args];
                next[i] = e.target.value;
                setArgs(next);
                setTarget(null);
              }}
            />
          </label>
        ))}
        <div className="x402__endpoint">
          <code className="mono">{`GET ${API_PATH}/${id}`}</code>
          <button type="button" className="chip chip--mode" onClick={copyUrl}>
            {copied ? "Copied" : "Copy URL"}
          </button>
        </div>
        <div className="group__row group__row--actions">
          <Gel onClick={() => setTarget(previewUrl)} disabled={missing !== undefined}>
            {missing ? `Enter the ${missing.name}` : "Read price"}
          </Gel>
          <span className="chip">{formatAmount(priceOf(id), USDC.decimals)} USDC / call</span>
        </div>
        <p className="dim">
          This one costs about {formatAmount(priceOf(id), USDC.decimals)} USDC a call, paid to {BRAND.name}&apos;s fee address on Base. The price
          you sign is the one {BRAND.name}&apos;s API states when asked; a call that fails is not charged. The same tools are free in the
          Check and Research windows — this is how an agent, or anyone outside this page, pays for them.
        </p>
      </fieldset>
      {target ? <X402Url key={target} fixedUrl={target} {...props} /> : null}
    </>
  );
}
