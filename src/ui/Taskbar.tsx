import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";
import { FOLDER_IDS, entryOf, folderItems, type Entry, type WindowId } from "@/features/registry";
import { Icon } from "@/ui/icons";
import { WalletStatus } from "@/ui/WalletStatus";
import { BlockClock, SoundToggle } from "@/ui/TrayExtras";

export type TaskbarWindow = {
  id: string;
  title: string;
  minimized: boolean;
  /** the un-minimised window currently on top — at most one true at a time */
  focused: boolean;
};

export type TaskbarProps = {
  windows: readonly TaskbarWindow[];
  /** pick a window in the Windows menu: restore if minimised, bring to front if not on top, minimise if it is */
  onToggle: (id: string) => void;
  /** "Show Desktop" — every window out of the way on the desktop, "go home" on a standalone page */
  onStart: () => void;
  /**
   * Present only on the desktop: a menu item opens a window in place.
   * Absent on the standalone pages, where an item is a plain link
   * back to `/?do=<id>` — same reasoning as `IconMenu`'s `onOpen`.
   */
  onOpenFeature?: (id: WindowId) => void;
};

/** Above the folders in the app's own menu: the programs that live on the desktop itself rather than in one. */
const START_TOP: readonly WindowId[] = ["terminal", "readme"];

/** The app's own mark — this app's pixel machine, never anybody's logo. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="1" width="12" height="12" fill="#000" />
      <rect x="3" y="2" width="10" height="8" fill="#0052ff" />
      <rect x="6" y="4" width="4" height="4" fill="#fff" />
      <rect x="7" y="5" width="2" height="2" fill="#0052ff" />
      <rect x="9" y="7" width="2" height="2" fill="#fff" />
      <rect x="3" y="11" width="10" height="1" fill="#d7d1c0" />
      <rect x="4" y="13" width="8" height="2" fill="#000" />
    </svg>
  );
}

/**
 * The Mac OS 8 "Platinum" menu bar (2026-10-22), which replaced the XP taskbar and its Start menu. Every
 * guarantee the taskbar gave survives here, moved to where a Macintosh keeps it:
 *   - this app's own menu (left, its mark) holds every program, grouped by the desktop's folders —
 *     what the Start menu held; each folder is ALSO its own menu title on a wide screen;
 *   - the Windows menu (far right, the Mac OS application menu) lists every open window: picking
 *     one restores, fronts or hides it, exactly as a taskbar chip did, and "Show Desktop" puts every
 *     window away (on a standalone page it goes home);
 *   - the tray — the chain, the wallet, the sound and the block clock — sits on the right.
 * One menu is open at a time; an outside click or Esc closes it; while one is open, moving over
 * another title opens that one instead, as the Finder does.
 */
export function Taskbar({ windows, onToggle, onStart, onOpenFeature }: TaskbarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(null);

  /** One menu line: opens the window on the desktop, or links back to it from a standalone page. */
  const item = (e: Entry, extra = "") => {
    const body = (
      <>
        <Icon id={e.id} />
        <span>{e.title}</span>
      </>
    );
    const className = `menu__item ${extra}`;
    return onOpenFeature ? (
      <button
        type="button"
        role="menuitem"
        className={className}
        onClick={() => {
          onOpenFeature(e.id);
          close();
        }}
      >
        {body}
      </button>
    ) : (
      <Link to={e.doc ? e.doc.path : `/?do=${e.id}`} role="menuitem" className={className} onClick={close}>
        {body}
      </Link>
    );
  };

  /** A menu title and, while it is the open one, its menu. */
  const menu = (key: string, title: ReactNode, label: string, items: ReactNode, extra = "") => (
    <div className={`menubar__menu ${extra}`}>
      <button
        type="button"
        className="menubar__title"
        aria-haspopup="menu"
        aria-expanded={open === key}
        aria-label={label}
        onClick={() => setOpen((v) => (v === key ? null : key))}
        onMouseEnter={() => setOpen((v) => (v === null ? v : key))}
      >
        {title}
      </button>
      {open === key ? (
        <div className="menu" role="menu" aria-label={`${label} menu`}>
          {items}
        </div>
      ) : null}
    </div>
  );

  const focused = windows.find((w) => w.focused);

  return (
    <nav className="menubar" aria-label="Menu bar" ref={barRef}>
      {menu(
        "app",
        <BrandMark />,
        BRAND.name,
        <>
          <ul className="menu__list">
            {START_TOP.map((id) => (
              <li key={id}>{item(entryOf(id))}</li>
            ))}
          </ul>
          {FOLDER_IDS.map((folder) => (
            <div key={folder} className="menu__group" role="group" aria-label={entryOf(folder).title}>
              {item(entryOf(folder), "menu__item--folder")}
              <ul className="menu__list menu__list--sub">
                {folderItems(folder).map((e) => (
                  <li key={e.id}>{item(e)}</li>
                ))}
              </ul>
            </div>
          ))}
        </>,
        "menubar__menu--app",
      )}
      {FOLDER_IDS.map((folder) =>
        menu(
          folder,
          entryOf(folder).title,
          `${entryOf(folder).title} folder`,
          <ul className="menu__list">
            <li>{item(entryOf(folder), "menu__item--folder")}</li>
            {folderItems(folder).map((e) => (
              <li key={e.id}>{item(e)}</li>
            ))}
          </ul>,
          "menubar__menu--folder",
        ),
      )}
      <div className="menubar__tray">
        <span className="menubar__chain" title={`Chain ${BASE.id}`}>
          {BASE.name}
        </span>
        <span className="menubar__nokey mono" title="No key is held by this site">
          no key held
        </span>
        <WalletStatus />
        <SoundToggle />
        <BlockClock onOpen={onOpenFeature ? () => onOpenFeature("taskmgr") : undefined} />
        {menu(
          "windows",
          <span className="menubar__switch">
            {focused ? <Icon id={focused.id as WindowId} /> : <BrandMark />}
          </span>,
          "Windows",
          <>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                onStart();
                close();
              }}
            >
              <span>Show Desktop</span>
            </button>
            <ul className="menu__list menu__list--windows">
              {windows.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={w.focused}
                    className={`menu__item ${w.minimized ? "menu__item--hidden" : ""}`}
                    onClick={() => {
                      onToggle(w.id);
                      close();
                    }}
                  >
                    <span className="menu__check" aria-hidden="true">
                      {w.focused ? "✓" : ""}
                    </span>
                    <Icon id={w.id as WindowId} />
                    <span>{w.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>,
          "menubar__menu--windows",
        )}
      </div>
    </nav>
  );
}
