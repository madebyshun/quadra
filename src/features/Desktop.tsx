import { BRAND } from "@/brand";
import type { WindowId } from "@/features/registry";
import { IconMenu } from "@/features/IconMenu";
import { Icon } from "@/ui/icons";

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
        <h1 className="home__brand">
          <button type="button" className="home__brand-link" onClick={onHome} aria-label={`${BRAND.name} — home`}>
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
        <p className="home__tagline">{BRAND.tagline}</p>
      </header>

      <IconMenu onOpen={onOpen} />
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
