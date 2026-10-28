import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useInRouterContext, useSearchParams } from "react-router-dom";
import type { WindowId } from "@/features/registry";
import { parseCommand, runKey, skillOpening } from "@/features/commands";

/**
 * How one window opens another — Coins' "Launch a token" opens Launch, a report's next step opens
 * the window it names. The desktop (`Home` in App.tsx) provides it. Outside the desktop (a panel
 * mounted on its own, as in a test) there is no window to open, so `useOpenWindow` answers `null`
 * and the caller hides its button rather than offering one that does nothing.
 *
 * `params` are what the window should show: they go into the page's URL, where the window reads
 * them (see `commands.ts` for which are state and which are one-time instructions).
 */
export type OpenWindowFn = (id: WindowId, params?: Readonly<Record<string, string>>) => void;
const OpenWindow = createContext<OpenWindowFn | null>(null);

export function OpenWindowProvider({ open, children }: { open: OpenWindowFn; children: ReactNode }) {
  return <OpenWindow.Provider value={open}>{children}</OpenWindow.Provider>;
}

export function useOpenWindow(): OpenWindowFn | null {
  return useContext(OpenWindow);
}

/**
 * Run a command line from anywhere in the app — a button, a report's next step. A skill opens its
 * home window, told to run it; a window command opens that window. `null` outside the desktop. The
 * returned function answers why when it could not act (an unknown word, a window switched off).
 */
export function useRunCommand(): ((line: string) => string | null) | null {
  const open = useOpenWindow();
  const run = useCallback(
    (line: string): string | null => {
      const c = parseCommand(line);
      if (c.kind === "open") open!(c.opening.window, c.opening.params);
      else if (c.kind === "skill") {
        const o = skillOpening(c.skill, c.args);
        open!(o.window, o.params);
      } else if (c.kind === "off") return `${c.title} is not switched on.`;
      else if (c.kind === "unknown") return `No command "${c.word}".`;
      else if (c.kind === "say") return c.text;
      else open!("terminal", { [runKey("terminal")]: line });
      return null;
    },
    [open],
  );
  return open ? run : null;
}

/**
 * A one-time instruction to this window in the URL (`run-<window>`, `to`, `buy`): applied when it arrives —
 * on opening, or later while the window is open — then cleared, so reopening the window does not
 * repeat it.
 */
export function useInbox(key: string, apply: (value: string) => void, enabled = true): void {
  // a panel mounted without a router (on its own, as in a test) has no URL to read instructions from;
  // whether there is one never changes for the life of a component, so the branch below is stable
  if (!useInRouterContext()) return;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useRoutedInbox(key, apply, enabled);
}

function useRoutedInbox(key: string, apply: (value: string) => void, enabled: boolean): void {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  useEffect(() => {
    // a panel embedded elsewhere (Trade's Swap) is not the window an instruction was addressed to
    if (value === null || !enabled) return;
    apply(value);
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next, { replace: true });
    // the instruction is the trigger; `apply` and `params` change with every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
