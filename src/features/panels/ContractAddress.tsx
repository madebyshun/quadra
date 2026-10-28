import { useEffect, useRef, useState, type MouseEvent } from "react";
import { BLOCKSCOUT_SITE, explorer, short } from "@/skills/format";
import "./ContractAddress.css";

/** How long "Copied" stays on the button. */
export const COPIED_MS = 1500;

type CopyState = "idle" | "copied" | "manual";

/**
 * Put text on the clipboard. Resolves true when the Clipboard API took it, false when it is absent or
 * refused (an insecure origin, a denied permission) — the caller then asks the person to copy by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  const clip = navigator.clipboard as Clipboard | undefined;
  if (!clip?.writeText) return false;
  try {
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Select an element's text, so a manual copy needs one keystroke. */
function selectAll(el: HTMLElement) {
  // null in a hidden frame: then the note alone tells the person what to do
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * A coin's contract address, in full, with Copy and the two explorers (2026-10-22, the owner: "the
 * CA, prominently"). The full address is the thing to check against a copycat with the same name, so
 * it is never shortened here.
 */
export function ContractAddress({ address }: { address: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const value = useRef<HTMLElement>(null);
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(t);
  }, [state]);
  const onCopy = async () => {
    if (await copyText(address)) return setState("copied");
    selectAll(value.current!);
    setState("manual");
  };
  return (
    <p className="ca" aria-label="Contract address">
      <span className="ca__label">CA</span>
      <code className="ca__value" ref={value}>
        {address}
      </code>
      <button type="button" className="chip" onClick={() => void onCopy()} aria-live="polite">
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <a className="chip" href={explorer.token(address)} target="_blank" rel="noopener noreferrer">
        Basescan
      </a>
      <a className="chip" href={`${BLOCKSCOUT_SITE}/token/${address}`} target="_blank" rel="noopener noreferrer">
        Blockscout
      </a>
      {state === "manual" ? <span className="ca__note">Copying is blocked here — the address is selected: press Ctrl+C (⌘C on a Mac).</span> : null}
    </p>
  );
}

/** A coin's CA in a list row: shortened, one click copies the full address. */
export function CopyCa({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const onClick = async (e: MouseEvent) => {
    e.stopPropagation();
    setCopied(await copyText(address));
  };
  return (
    <button type="button" className="chip ca__short" title={address} aria-label={`Copy contract address ${address}`} onClick={(e) => void onClick(e)}>
      {copied ? "Copied" : `CA ${short(address)}`}
    </button>
  );
}
