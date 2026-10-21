import { Link } from "react-router-dom";
import { Icon } from "@/ui/icons";
import { DOC_PAGES, desktopFeatures, type WindowId } from "@/features/registry";

export type IconMenuProps = {
  /**
   * Present only on the desktop: an icon opens a window in place. Absent on the
   * standalone pages (`/docs`, `/api`, `/verify`), where an icon is a plain link
   * — there is no window manager to open one into.
   */
  onOpen?: (id: WindowId) => void;
};

/** The left-hand icon column: every feature, plus the three doc pages. */
export function IconMenu({ onOpen }: IconMenuProps) {
  return (
    <div className="icon-field">
      <ul className="icons" aria-label="What you can do">
        {desktopFeatures().map((f) => {
          const body = (
            <>
              <span className="icon__glyph">
                <Icon id={f.id} />
              </span>
              <span className="icon__title">{f.title}</span>
              <span className="icon__blurb">{f.blurb}</span>
            </>
          );
          return (
            <li key={f.id}>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(f.id)}
                  className="icon"
                >
                  {body}
                </button>
              ) : (
                <Link
                  to={`/?do=${f.id}`}
                  className="icon"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        On the desktop these open a window like any other icon: following the
        route instead threw away the header, the badges and every other open
        window, which is a whole-page navigation dressed as a window.
      */}
      <ul className="icons icons--docs" aria-label="Read about it">
        {DOC_PAGES.map((d) => {
          const body = (
            <>
              <span className="icon__glyph">
                <Icon id={d.id} />
              </span>
              <span className="icon__title">{d.title}</span>
              <span className="icon__blurb">{d.blurb}</span>
            </>
          );
          return (
            <li key={d.id}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(d.id)} className="icon icon--doc">
                  {body}
                </button>
              ) : (
                <Link to={d.path} className="icon icon--doc">
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
