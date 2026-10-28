import { createContext, useContext, useSyncExternalStore } from "react";
import { PULSE, type PulseState, pulseStore } from "@/lib/pulse";

/** The page's pulse store. A test hands its own in, so no two tests share one poller's history. */
export const PulseContext = createContext<ReturnType<typeof pulseStore>>(PULSE);

/** The latest Base block, kept fresh while the calling component is mounted. */
export function usePulse(): PulseState {
  const store = useContext(PulseContext);
  return useSyncExternalStore(store.subscribe, store.get);
}
