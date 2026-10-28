import { useSyncExternalStore } from "react";
import { onSettingsChange } from "@/lib/settings";

/** One Control Panel setting, re-read whenever any of them changes. */
export function useSetting<T>(get: () => T): T {
  return useSyncExternalStore(onSettingsChange, get);
}
