import { BRAND } from "@/brand";
import type { WindowId } from "@/features/registry";
import { IconMenu } from "@/features/IconMenu";
import { Icon } from "@/ui/icons";
import { Link } from "react-router-dom";

export type DesktopProps = {
  /** a feature icon was clicked: open (or re-focus) its window */
  onOpen: (id: WindowId) => void;
  /** the name was clicked: back to the front page, as the menu bar's Home does */
  onHome: () => void;
};

export function Desktop({ onOpen, onHome }: DesktopProps) {
  return (
    <div className="home stack">
      <header className="home__head">
        <p className="home__path">desktop / base</p>
        <h1 className="home__brand">
          <button type="button" className="home__brand-link" onClick={onHome} aria-label={`${BRAND.name} — home`}>
            <img src="/brand/icon.svg" width="64" height="64" alt="" />
            {BRAND.name}
          </button>
        </h1>
        {/*
          Three status chips used to sit here — the feature count, "holds no key"
          and the pool's deployment state. Removed on the owner's call: the
          desktop leads with the name and the line, and the claims they made are
          still made where they can be acted on (the Docs window for the pool and
          the token, the MCP window for the key).
        */}
        <p className="home__tagline">{BRAND.desktopLine}</p>
      </header>

      <section className="workspace" aria-label="Desktop workspace">
        <div className="workspace__bar"><span className="workspace__box" aria-hidden="true" /><span>{BRAND.slug} / applications</span><span>base</span></div>
        <div className="workspace__intro"><span>your everyday tools</span><span>open a window to begin</span></div>
        <IconMenu onOpen={onOpen} />
        <div className="workspace__pinned"><span>pinned /</span><button type="button" onClick={() => onOpen("basket")}>treasury basket</button><button type="button" onClick={() => onOpen("terminal")}>terminal</button></div>
        <footer className="workspace__foot"><span>research / trade / create</span><span>your wallet signs</span></footer>
      </section>
      <nav className="home__links" aria-label="Product information"><a href="/?intro=explore">explore / desk</a><Link to="/about">read me / about</Link><Link to="/docs">documentation</Link><Link to="/api">api</Link></nav>
      {/* the Markets gadget left the desktop on 2026-10-29 (one door per job: Coins shows the coins);
          it lives on in the Markets window, in My Computer > Research */}
      {/* the Trash keeps its own corner, the way it always has */}
      <button type="button" className="icon desk-trash" onClick={() => onOpen("trash")}>
        <span className="icon__glyph">
          <Icon id="trash" />
        </span>
        <span className="icon__title">Trash</span>
      </button>
    </div>
  );
}
