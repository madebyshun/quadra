import { Icon } from "@/ui/icons";
import { desktopItems, type WindowId } from "@/features/registry";

export type IconMenuProps = {
  /** Open or refocus a desktop tool. */
  onOpen: (id: WindowId) => void;
};

/**
 * The left-hand icon column (2026-10-21): the folders, the four most-used programs and the Read Me.
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
              <button type="button" onClick={() => onOpen(e.id)} className="icon">
                {body}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
