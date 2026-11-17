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
  /** Desktop objects step aside while intro or Welcome owns the screen. */
  obscured: boolean;
};

export function Desktop({ onOpen, onHome, obscured }: DesktopProps) {
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

      <section className="workspace" aria-label="Desktop workspace" hidden={obscured}>
        <IconMenu onOpen={onOpen} />
        <div className="workspace__pinned" aria-label="Pinned tools">
          <button type="button" className="icon" onClick={() => onOpen("basket")}><span className="icon__glyph"><Icon id="basket" /></span><span className="icon__title">treasury basket</span></button>
          <button type="button" className="icon" onClick={() => onOpen("terminal")}><span className="icon__glyph"><Icon id="terminal" /></span><span className="icon__title">terminal</span></button>
        </div>
      </section>
      <nav className="home__links" aria-label="Product information" hidden={obscured}>
        <a className="icon" href="/?intro=explore"><span className="icon__glyph"><Icon id="computer" /></span><span className="icon__title">explore / desk</span></a>
        <button type="button" className="icon" onClick={() => onOpen("readme")}><span className="icon__glyph"><Icon id="docs" /></span><span className="icon__title">read me / about</span></button>
        <Link className="icon" to="/docs"><span className="icon__glyph"><Icon id="folder-research" /></span><span className="icon__title">documentation</span></Link>
        <Link className="icon" to="/api"><span className="icon__glyph"><Icon id="api" /></span><span className="icon__title">api</span></Link>
      </nav>
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
