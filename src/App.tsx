import { DesktopWallpaper } from "@/features/DesktopWallpaper";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLoanAlerts } from "@/features/loanAlerts";
import { Routes, Route, useSearchParams, useLocation } from "react-router-dom";
import { OpenWindowProvider } from "@/features/openWindow";
import { Desktop } from "@/features/Desktop";
import { FeaturePanel } from "@/features/FeaturePanel";
import { DocWindow } from "@/features/DocWindow";
import { TokenWindow } from "@/features/panels/TokenWindow";
import { comingSoon, folderItems, isFolder, isTokenWindow, resolveDoc, resolveFeature, tokenAddressOf, tokenWindowId, windowTitle, type WindowId } from "@/features/registry";
import { Window } from "@/ui/Window";
import { Taskbar } from "@/ui/Taskbar";
import { Docs } from "@/pages/Docs";
import { About } from "@/pages/About";
import { ApiPage, Developers } from "@/pages/ApiPage";
import { Verify } from "@/pages/Verify";
import { NotFound } from "@/pages/NotFound";
import { AdaptersProvider } from "@/adapters/AdaptersProvider";
import { WalletProvider } from "@/ui/WalletProvider";
import { MarketsProvider } from "@/features/markets/MarketsProvider";
import { PhotoIntro } from "@/intro/PhotoIntro";
import { Assistant } from "@/ui/Assistant";
import { TxToast } from "@/ui/TxToast";
import { Screensaver } from "@/ui/Screensaver";
import { Welcome } from "@/ui/Welcome";
import { showWelcome } from "@/lib/welcome";
import { setWallpaper, wallpaper } from "@/lib/settings";
import blissWallpaper from "@/assets/quadra-wallpaper.jpg";
import { useSetting } from "@/ui/useSettings";
import { shouldPlayIntro } from "@/intro/photo";
import {
  DEFAULT_HEIGHT,
  EMPTY_STATE,
  centeredOrigin,
  pageHeight,
  reduceWindows,
  topWindowId,
  type Origin,
} from "@/lib/windowManager";

/**
 * Measuring the viewport is the only thing a window needs the DOM for, and it
 * happens here so `windowManager` stays pure. A doc page opens at prose height,
 * a feature panel at panel height — the same split `Page.tsx` makes for the
 * standalone routes, through the same `pageHeight`.
 */
/**
 * Panels that open at prose height too. `x402` is a workbench: a price, a payee to
 * confirm, limits, a wallet line, a button and an output box that fills with whatever the
 * endpoint answered. MEASURED 2026-09-29 at the panel height (client 537): with a
 * confirmed payee the Pay button fit and the output box sat 43px below it, which is the
 * receipt of a payment out of sight — the same defect Send had with its own button.
 */
const TALL_PANELS: ReadonlySet<WindowId> = new Set<WindowId>([
  "trade",
  "coins",
  "stocks",
  "profile",
  "x402",
  "terminal",
  "taskmgr",
  "trash",
  "rugsweeper",
  "achievements",
  "leaderboard",
  "research",
  "safety",
  "markets",
  // a money form grows by a whole review once it is filled in (MEASURED: Swap by ~50px)
  "send",
  "swap",
  "bridge",
  "launch",
  "basket",
  "control",
  "readme",
]);

/**
 * Windows that open wider than a panel: a picture or a page that reads better at size (2026-10-21 —
 * the Base card measured 452px wide at the default width, the card itself a thumbnail). Still never
 * wider than the viewport allows.
 */
export const WIDE_PANELS: ReadonlySet<WindowId> = new Set<WindowId>(["card", "coins", "stocks", "profile", "launch", "readme", "markets", "trade", "basket"]);
export const LANDSCAPE_PANELS: ReadonlySet<WindowId> = new Set<WindowId>(["coins", "stocks", "profile", "markets", "trade", "basket"]);
export const WIDE_WIDTH = 760;
export const LANDSCAPE_WIDTH = 920;

function compactFolderHeight(id: WindowId): number | null {
  if (!isFolder(id) && id !== "soon") return null;
  const count = id === "soon" ? comingSoon().length : folderItems(id).length;
  const rows = Math.max(1, Math.ceil(count / 4));
  return Math.min(DEFAULT_HEIGHT, 180 + rows * 96);
}

function openAction(id: WindowId): { type: "open"; id: WindowId; origin: Origin; height: number } {
  const tokenWin = isTokenWindow(id);
  const tall = tokenWin || TALL_PANELS.has(id);
  const folderH = compactFolderHeight(id);
  /**
   * A tall panel never opens SHORTER than an ordinary one. `pageHeight` fits prose to the
   * viewport (innerHeight − 120), and on a 673px viewport that is 553 — below
   * `DEFAULT_HEIGHT`, so "tall" measured shorter than the panel height it was meant to beat.
   * Prose may shrink to fit; a workbench keeps at least the room every panel gets.
   * Sparse folders open compactly to fit their icon rows without a huge blank tail.
   */
  const height = resolveDoc(id) !== null
    ? pageHeight(window.innerHeight)
    : folderH !== null
      ? Math.min(folderH, pageHeight(window.innerHeight))
      : tall
        ? Math.max(DEFAULT_HEIGHT, pageHeight(window.innerHeight))
        : DEFAULT_HEIGHT;
  const origin = centeredOrigin(window.innerWidth, window.innerHeight, height);
  if (!tokenWin && !WIDE_PANELS.has(id)) return { type: "open", id, origin, height };
  const targetWidth = tokenWin || LANDSCAPE_PANELS.has(id) ? LANDSCAPE_WIDTH : WIDE_WIDTH;
  // centeredOrigin always fits a width to the viewport; a wide window takes more of it, never less
  const width = Math.max(origin.width!, Math.min(targetWidth, window.innerWidth - 16));
  const x = Math.max(8, Math.round((window.innerWidth - width) / 2));
  return { type: "open", id, origin: { ...origin, x, width, maxX: Math.max(x, window.innerWidth - 8 - width) }, height };
}

/**
 * The multi-window desktop. `?do=<id>` still opens a window on first load — a
 * saved link has to keep working — but once the page is up, the URL only ever
 * tracks whichever window is on top; every other open window lives in
 * `windowManager` state and is lost on refresh. That split is deliberate (see
 * `TASKS.md`): the alternative, a comma-separated `?do=`, makes every drag and
 * every focus change a history write.
 */
function Home({ introPlayed, onIntroDone }: { introPlayed: boolean; onIntroDone: () => void }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const fromPage = Boolean((location.state as { fromPage?: boolean } | null)?.fromPage);
  const desktopDemo = import.meta.env.DEV && params.get("wallpaper") === "motion";
  const forceIntro = params.get("intro") === "explore";
  const [state, dispatch] = useReducer(reduceWindows, EMPTY_STATE);
  const openedFromUrl = useRef(false);
  const syncingInitial = useRef(false);
  // decided once, on the first render: never replay intro when returning from /docs, /api, /verify, or /about
  const [intro, setIntro] = useState(() =>
    !desktopDemo && (forceIntro
      ? shouldPlayIntro({ search: params.toString(), matchMedia: window.matchMedia?.bind(window) })
      : !introPlayed && !fromPage && shouldPlayIntro({ search: params.toString(), matchMedia: window.matchMedia?.bind(window) })),
  );
  // decided once too: the Welcome screen follows the intro (or a bare load), never a `?do=` link or closing a page tab
  const [welcomeAtStart] = useState(() => !desktopDemo && !fromPage && showWelcome(params.toString()));
  const [welcome, setWelcome] = useState(welcomeAtStart);
  const closeWelcome = useCallback(() => setWelcome(false), []);
  // the intro always hands over to the desktop (and the Welcome screen after it); it opens no window itself
  const endIntro = useCallback(() => {
    onIntroDone();
    setIntro(false);
  }, [onIntroDone]);

  const [, setTitleTick] = useState(0);
  const bumpTitles = useCallback(() => setTitleTick((n) => n + 1), []);

  /** Reads `?do=` exactly once, on mount — after that, the URL follows the topmost window, not the other way round. */
  useEffect(() => {
    if (openedFromUrl.current) return;
    openedFromUrl.current = true;
    const raw = params.get("do");
    const t = params.get("t");
    if (raw === "token" && t && /^0x[0-9a-fA-F]{40}$/.test(t)) {
      syncingInitial.current = true;
      dispatch(openAction(tokenWindowId(t)));
      return;
    }
    const initial = resolveFeature(raw) ?? resolveDoc(raw);
    if (initial) {
      syncingInitial.current = true;
      dispatch(openAction(initial.id));
    }
  }, [params]);

  const topId = topWindowId(state);
  /**
   * Parameters a window was opened with, not yet in the URL. MEASURED 2026-10-02 in a real browser:
   * the router applies a search-param change in a transition, so the `do=` sync below — which runs on
   * the same click — wrote the URL from the OLD parameters and dropped `a=…` / `t=…`. The sync merges
   * them instead, whichever of the two writes lands last.
   */
  const pending = useRef<Record<string, string>>({});

  /** set by Home: the next sync writes the bare page, whatever the router still reports (it lags a transition) */
  const homing = useRef(false);

  const WINDOW_SCOPED_PARAMS = ["t", "s", "a", "pair", "tab", "sort", "q", "c"] as const;

  useEffect(() => {
    if (syncingInitial.current) {
      if (!topId) return;
      syncingInitial.current = false;
    }
    if (homing.current) {
      homing.current = false;
      if (params.toString() !== "") setParams(new URLSearchParams(), { replace: true });
      return;
    }
    const current = params.get("do");
    const currentT = params.get("t")?.toLowerCase() ?? null;
    const expectedDo = topId ? (isTokenWindow(topId) ? "token" : topId) : null;
    const expectedT = topId && isTokenWindow(topId) ? tokenAddressOf(topId).toLowerCase() : null;
    const hasPending = Object.keys(pending.current).length > 0;
    if (expectedDo === current && (!expectedT || expectedT === currentT) && !hasPending) return;
    const next = new URLSearchParams(params);
    if (!topId) {
      next.delete("do");
      for (const k of WINDOW_SCOPED_PARAMS) next.delete(k);
      pending.current = {};
    } else if (isTokenWindow(topId)) {
      for (const k of WINDOW_SCOPED_PARAMS) next.delete(k);
      pending.current = {};
      next.set("do", "token");
      next.set("t", tokenAddressOf(topId));
    } else {
      if (expectedDo !== current) {
        for (const k of WINDOW_SCOPED_PARAMS) {
          if (!(k in pending.current)) next.delete(k);
        }
      }
      for (const [k, v] of Object.entries(pending.current)) next.set(k, v);
      pending.current = {};
      next.set("do", topId);
    }
    setParams(next, { replace: true });
  }, [topId, params, setParams]);

  useEffect(() => {
    if (!topId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "close", id: topId });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [topId]);

  const openFeature = useCallback(
    (id: WindowId) => {
      // Clicking Coins from the desktop while viewing a token returns to Coins Discover.
      if (id === "coins" && params.has("t")) {
        const next = new URLSearchParams(params);
        next.delete("t");
        setParams(next, { replace: true });
      }
      dispatch(openAction(id));
    },
    [params, setParams],
  );
  /** Open a window with what it should show — its parameters go into the URL, where it reads them. */
  const openWith = useCallback(
    (id: WindowId, extra: Readonly<Record<string, string>> = {}) => {
      if (Object.keys(extra).length) {
        pending.current = { ...pending.current, ...extra };
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            for (const [k, v] of Object.entries(extra)) next.set(k, v);
            return next;
          },
          { replace: true },
        );
      }
      dispatch(openAction(id));
    },
    [setParams],
  );
  const showDesktop = useCallback(() => dispatch({ type: "minimizeAll" }), []);
  /**
   * Home: every window CLOSED, the URL back to the bare page, and the Welcome screen — the front door —
   * open again. MEASURED 2026-11-04 on the deploy: minimising left `?t=0x…` in the address bar, so Home
   * read as "still on that coin"; a window's state lives in the URL (`t`, `a`), so Home clears it all.
   */
  const goHome = useCallback(() => {
    // the router applies a param change in a transition, so the do= sync below would write the OLD
    // parameters back (MEASURED: `?t=` survived Home in the full suite); `homing` makes it write none
    // — set only when a window closes, because only then does that sync run (and clear the flag)
    pending.current = {};
    if (state.windows.length > 0) {
      homing.current = true;
      for (const w of state.windows) dispatch({ type: "close", id: w.id });
    } else if (params.toString() !== "") {
      setParams(new URLSearchParams(), { replace: true });
    }
    setWelcome(true);
    window.scrollTo(0, 0);
  }, [state.windows, params, setParams]);
  const openMarkets = useCallback(() => dispatch(openAction("markets")), []);

  return (
    <MarketsProvider onOpen={openMarkets}>
      <OpenWindowProvider open={openWith}>
      <Desktop onOpen={openFeature} onHome={goHome} obscured={welcome || intro} />
      {/* `w.id: WindowId` is exactly the key space the two resolvers were built from — every open window resolves to one or the other. */}
      {state.windows.map((w) => {
        const doc = resolveDoc(w.id);
        return (
          <Window
            key={w.id}
            title={windowTitle(w.id)}
            onClose={() => dispatch({ type: "close", id: w.id })}
            layout={{
              x: w.x,
              y: w.y,
              width: w.width,
              height: w.height,
              zIndex: w.z,
              visible: !w.minimized,
              active: w.id === topId,
              onFocus: () => dispatch({ type: "focus", id: w.id }),
              onMinimize: () => dispatch({ type: "minimize", id: w.id }),
              onMove: (x, y) => dispatch({ type: "move", id: w.id, x, y }),
              onResize: (width, height) => dispatch({ type: "resize", id: w.id, width, height }),
            }}
          >
            {isTokenWindow(w.id) ? (
              <TokenWindow address={tokenAddressOf(w.id)} onTitle={bumpTitles} />
            ) : doc ? (
              <DocWindow id={doc.id} />
            ) : (
              <FeaturePanel feature={resolveFeature(w.id)!} />
            )}
          </Window>
        );
      })}
      <Taskbar
        windows={state.windows.map((w) => ({
          id: w.id,
          title: windowTitle(w.id),
          minimized: w.minimized,
          focused: w.id === topId,
        }))}
        onToggle={(id) => dispatch({ type: "toggleFromTaskbar", id: id as WindowId })}
        onStart={showDesktop}
        onHome={goHome}
        onOpenFeature={openFeature}
      />
      {/* Q no longer greets on its own (2026-10-29, the owner: "extremely simple"): it speaks only when
          something real happens — a red verdict, fees waiting, a Rugsweeper win */}
      {intro ? <PhotoIntro onDone={endIntro} /> : <Assistant greet={false} />}
      {!intro && <TxToast />}
      <LoanAlerts />
      {!intro && welcome && <Welcome onClose={closeWelcome} />}
      {!intro && <Screensaver />}
      </OpenWindowProvider>
    </MarketsProvider>
  );
}

export function App() {
  const { pathname, search } = useLocation();
  const [introPlayed, setIntroPlayed] = useState(false);
  const markIntroPlayed = useCallback(() => setIntroPlayed(true), []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (import.meta.env.DEV && pathname === "/" && new URLSearchParams(search).get("wallpaper") === "motion") {
      setWallpaper("motion");
    }
  }, [pathname, search]);
  // the Control Panel's wallpaper, applied to the whole page the moment it is picked
  const paper = useSetting(wallpaper);
  return (
    <AdaptersProvider>
      {/*
        One wallet session for the page, above the router: the taskbar tray and
        the Connect wallet window are the same session, so signing in through
        either shows in both. See `ui/WalletProvider.tsx`.
      */}
      <WalletProvider>
        <div
          className={`desktop wallpaper--${paper}`}
          style={paper === "bliss" ? { backgroundImage: `url(${blissWallpaper})` } : undefined}
        >
          {paper === "motion" && <DesktopWallpaper />}
          <Routes>
            <Route path="/" element={<Home introPlayed={introPlayed} onIntroDone={markIntroPlayed} />} />
            <Route path="/about" element={<About />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/developers" element={<Developers />} />
            <Route path="/api" element={<ApiPage />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </WalletProvider>
    </AdaptersProvider>
  );
}

/** Liquidation alerts for the wallets this browser watches (features/loanAlerts.tsx) — renders nothing. */
function LoanAlerts() {
  useLoanAlerts();
  return null;
}
