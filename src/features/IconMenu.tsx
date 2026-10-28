import { Link } from "react-router-dom";
import { Icon } from "@/ui/icons";
import { desktopItems, type WindowId } from "@/features/registry";

export type IconMenuProps = {
  /**
   * Present only on the desktop: an icon opens a window in place. Absent on the
   * standalone pages (`/docs`, `/api`, `/verify`), where an icon is a plain link
   * — there is no window manager to open one into.
   */
  onOpen?: (id: WindowId) => void;
};

/**
 * The left-hand icon column (2026-10-21): the folders, the four most-used programs and README.TXT.
 * Everything else lives in a folder — the desktop of ~20 icons read like a settings page.
 */
export function IconMenu({ onOpen }: IconMenuProps) {
  return (
    <div className="icon-field">
      <ul className="icons" aria-label="What you can do">
        {desktopItems().map((e) => {
          const body = (
            <>
              <span className="icon__glyph">
                <Icon id={e.id} />
              </span>
              <span className="icon__title">{e.title}</span>
              <span className="icon__blurb">{e.blurb}</span>
            </>
          );
          return (
            <li key={e.id}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(e.id)} className="icon">
                  {body}
                </button>
              ) : (
                <Link to={`/?do=${e.id}`} className="icon">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
