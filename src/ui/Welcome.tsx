import quadraMachine from "@/assets/quadra-q001.svg";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BRAND } from "@/brand";
import { resolveFeature, type WindowId } from "@/features/registry";
import { useOpenWindow, useRunCommand } from "@/features/openWindow";
import { checkAddress } from "@/lib/address";
import { injectedProvider } from "@/lib/wallet";
import { Gel } from "@/ui/Gel";
import { useOptionalWalletSession } from "@/ui/WalletProvider";
import { setWelcomeOn, welcomeOn } from "@/lib/welcome";

/** The Base card's window — `card` once it exists, the profile (where the card began) until then. */
export function cardWindow(resolve: (id: string) => unknown = resolveFeature): WindowId {
  return (resolve("card") ? "card" : "profile") as WindowId;
}

/**
 * The Welcome screen, after the intro (or on a bare desktop load) — since 2026-10-29 the app's front
 * door, and nothing else (the owner: "extremely simple, no overlapping features"): paste a token to
 * check it, or launch a coin, or browse the coins launched here. Three doors, one line each. The tips,
 * What's New and the playful doors moved out; everything they opened is still in My Computer.
 */
export function Welcome({ onClose }: { onClose: () => void }) {
  const open = useOpenWindow();
  const run = useRunCommand();
  const session = useOptionalWalletSession();
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [again, setAgain] = useState(welcomeOn);

  // Esc dismisses the dialog first, before it reaches the window underneath
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      latestClose.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const go = (id: WindowId) => () => {
    open!(id);
    onClose();
  };
  const connectFromWelcome = () => {
    open!("wallet");
    onClose();
    if (!session || session.busy) return;
    if (session.wallet?.kind === "wrongChain") {
      void session.switchChain();
    } else if (session.wallet?.kind !== "ready") {
      if (session.wallets.length === 1) void session.connectDiscovered(session.wallets[0]!);
      else if (session.wallets.length === 0 && injectedProvider() !== null && session.wallet?.kind !== "unavailable") void session.connectInjected();
    }
  };
  const check = (e: FormEvent) => {
    e.preventDefault();
    const c = checkAddress(token);
    if (c.kind === "malformed" || c.kind === "mismatch") return setProblem(c.why);
    // Token Verdict, in the Check window: a coin launched here links on to its own page from there
    run!(`verdict ${token.trim()}`);
    onClose();
  };

  return (
    <div className="welcome" role="presentation">
      <section className="win welcome__win" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="win__bar">
          <button type="button" className="light light--close" onClick={onClose} aria-label="Close Welcome" title="Close" />
          <h2 className="win__title">
            <span>Welcome</span>
          </h2>
        </div>
        <div className="win__body welcome__body">
          <div className="welcome__sky" aria-hidden="true">
            <img className="welcome__sky-img" src={quadraMachine} width="620" height="680" alt="" />
            <div className="welcome__sky-copy">
              <p className="welcome__sky-title">
                a personal computer.
                <br />
                <em>an open world.</em>
              </p>
              <p className="welcome__sky-sub">base 8453 · open · verify · sign</p>
            </div>
          </div>
          <h1 id="welcome-title" className="welcome__head">
            Welcome to <b>{BRAND.name}</b>
          </h1>
          {/* short, in the era's voice (2026-11-04, after c-na.dev's "The desk is ready.") */}
          <p className="welcome__lede">
            Check a token. Launch a coin. Trade it. Your wallet signs; nothing else can. <Link className="chip" to="/about">what is quadra /</Link>
          </p>
          <form className="welcome__check" onSubmit={check} aria-label="Check a token">
            <label className="field-label" htmlFor="welcome-token">
              Check a token before you buy it
            </label>
            <div className="welcome__checkrow">
              <input
                id="welcome-token"
                className="field mono"
                placeholder="paste a token address, 0x..."
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setProblem(null);
                }}
              />
              <Gel type="submit" disabled={token.trim() === ""}>
                Check
              </Gel>
            </div>
            {problem ? <p className="tx__warn">{problem}</p> : null}
          </form>
          <div className="welcome__doors">
            <Gel quiet onClick={go("launch")}>
              Launch a coin
            </Gel>
            <Gel quiet onClick={go("coins")}>
              Browse coins
            </Gel>
            <Gel quiet onClick={connectFromWelcome}>
              Connect wallet
            </Gel>
          </div>
          <label className="welcome__again">
            <input
              type="checkbox"
              checked={again}
              onChange={(e) => {
                setAgain(e.target.checked);
                setWelcomeOn(e.target.checked);
              }}
            />
            Show this Welcome Screen next time you start {BRAND.name}
          </label>
        </div>
      </section>
    </div>
  );
}
