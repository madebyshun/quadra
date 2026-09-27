import { FLAGS, type FlagName } from "@/config/chain";

/**
 * The whole app is one page. `?do=<id>` picks which window is open; no id means
 * the desktop. Ids are permanent — a link someone saved has to keep working.
 */
export type FeatureId =
  | "swap"
  | "inference"
  | "router"
  | "send"
  | "mcp"
  | "bridge"
  | "launch"
  | "audit"
  | "hooks"
  | "x402";

export type Feature = {
  id: FeatureId;
  /** the word on the card */
  title: string;
  /** one line, second person, no jargon — this is the voice of the product */
  blurb: string;
  /** title bar text when the window is open */
  window: string;
  /** which flag switches it on */
  flag: FlagName;
};

export const FEATURES: readonly Feature[] = [
  {
    id: "swap",
    title: "Swap",
    blurb: "trade with nothing tying it to you",
    window: "Swap",
    flag: "swap",
  },
  {
    id: "inference",
    title: "Inference",
    blurb: "rent a private GPU",
    window: "Private inference",
    flag: "inference",
  },
  {
    id: "router",
    title: "Router",
    blurb: "pay any service, any token",
    window: "Payment router",
    flag: "router",
  },
  {
    id: "send",
    title: "Send",
    blurb: "pay anyone, no link back",
    window: "Send",
    flag: "send",
  },
  {
    id: "mcp",
    title: "MCP",
    blurb: "hand all of it to another agent",
    window: "MCP tools",
    flag: "mcp",
  },
  {
    id: "bridge",
    title: "Bridge",
    blurb: "out to Solana or Arbitrum",
    window: "Bridge",
    flag: "bridge",
  },
  {
    id: "launch",
    title: "Launch",
    blurb: "a coin, fees to any X account",
    window: "Launch",
    flag: "launch",
  },
  {
    id: "audit",
    title: "Audit",
    blurb: "score any GitHub repo",
    window: "Audit",
    flag: "audit",
  },
  {
    id: "hooks",
    title: "Hooks",
    blurb: "what runs on your swap",
    window: "Hooks",
    flag: "hooks",
  },
  {
    id: "x402",
    title: "x402",
    blurb: "pay any 402 endpoint",
    window: "x402",
    flag: "x402",
  },
] as const;

const BY_ID = new Map<string, Feature>(FEATURES.map((f) => [f.id, f]));

/** Resolve `?do=` to a feature, or null for the desktop. Unknown ids are null. */
export function resolveFeature(raw: string | null): Feature | null {
  if (!raw) return null;
  return BY_ID.get(raw) ?? null;
}

export function isEnabled(f: Feature): boolean {
  return FLAGS[f.flag];
}

/** Cards shown on the desktop: enabled ones first, off ones still visible but marked. */
export const VISIBLE_FEATURES: readonly Feature[] = FEATURES;
