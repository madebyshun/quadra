import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Adapters } from "@/adapters/types";
import { adapters as buildAdapters } from "@/adapters";

/**
 * One pool for the whole page.
 *
 * Notes live in the adapter, and closing a window must not lose them — the app
 * is a single page with `?do=` switching, so a panel that built its own adapter
 * would silently discard every note the moment the user looked at something else.
 *
 * A context rather than a module singleton, so a test can mount the tree against
 * a stub without reaching into module state, and so two mounted trees never
 * share notes by accident.
 */

const Ctx = createContext<Adapters | null>(null);

export function AdaptersProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: Adapters;
}) {
  const fallback = useMemo(() => buildAdapters(), []);
  return <Ctx.Provider value={value ?? fallback}>{children}</Ctx.Provider>;
}

/**
 * Throws rather than building an adapter on the spot. A component rendered
 * outside the provider would otherwise get its own private pool and appear to
 * work, while the notes it creates are invisible everywhere else.
 */
export function useAdapters(): Adapters {
  const found = useContext(Ctx);
  if (!found) {
    throw new Error("useAdapters must be called inside <AdaptersProvider>.");
  }
  return found;
}
