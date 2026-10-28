import { BRAND } from "@/brand";
import type { WindowId } from "@/features/registry";
import { IconMenu } from "@/features/IconMenu";
import { MarketsGadget } from "@/features/markets/MarketsGadget";
import { Icon } from "@/ui/icons";

export type DesktopProps = {
  /** a feature icon was clicked: open (or re-focus) its window */
  onOpen: (id: WindowId) => void;
};

export function Desktop({ onOpen }: DesktopProps) {
  return (
    <div className="home stack">
      <header className="home__head">
        <h1 className="home__brand">{BRAND.name}</h1>
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
      <MarketsGadget />
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
