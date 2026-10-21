import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";
import { DOC_PAGES, visibleFeatures, isEnabled, type WindowId } from "@/features/registry";
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
  /** click a chip: restore if minimised, bring to front if not on top, minimise if it is */
  onToggle: (id: string) => void;
  /** always fires on a Start click — "show desktop" on the desktop, "go home" on a standalone page */
  onStart: () => void;
  /**
   * Present only on the desktop: a Start-menu feature opens a window in place.
   * Absent on the standalone pages, where a Start-menu feature is a plain link
   * back to `/?do=<id>` — same reasoning as `IconMenu`'s `onOpen`.
   */
  onOpenFeature?: (id: WindowId) => void;
};

/**
 * The Start button used to only ever call `onStart`, which is a no-op the
 * moment no window is open — indistinguishable from a dead button. It now
 * also opens a menu of every feature and doc page, so a click always shows
 * something regardless of what is currently open.
 */
export function Taskbar({ windows, onToggle, onStart, onOpenFeature }: TaskbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="taskbar" aria-label="Taskbar">
      <div className="taskbar__start-wrap" ref={wrapRef}>
        {menuOpen ? (
          <div className="start-menu" role="menu" aria-label="Start menu">
            <ul className="start-menu__list">
              {visibleFeatures().map((f) => {
                const on = isEnabled(f);
                const body = (
                  <>
                    <Icon id={f.id} />
                    <span>{f.title}</span>
                  </>
                );
                return (
                  <li key={f.id}>
                    {onOpenFeature ? (
                      <button
                        type="button"
                        role="menuitem"
                        className={`start-menu__item ${on ? "" : "start-menu__item--off"}`}
                        onClick={() => {
                          onOpenFeature(f.id);
                          closeMenu();
                        }}
                      >
                        {body}
                      </button>
                    ) : (
                      <Link
                        to={`/?do=${f.id}`}
                        role="menuitem"
                        className={`start-menu__item ${on ? "" : "start-menu__item--off"}`}
                        onClick={closeMenu}
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <ul className="start-menu__list start-menu__list--docs">
              {DOC_PAGES.map((d) => {
                const body = (
                  <>
                    <Icon id={d.id} />
                    <span>{d.title}</span>
                  </>
                );
                return (
                  <li key={d.id}>
                    {onOpenFeature ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="start-menu__item"
                        onClick={() => {
                          onOpenFeature(d.id);
                          closeMenu();
                        }}
                      >
                        {body}
                      </button>
                    ) : (
                      <Link to={d.path} role="menuitem" className="start-menu__item" onClick={closeMenu}>
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          className="taskbar__start"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((v) => !v);
            onStart();
          }}
        >
          {BRAND.name}
        </button>
      </div>
      <div className="taskbar__windows">
        {windows.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`chip chip--task ${w.focused ? "chip--active" : ""}`}
            aria-pressed={w.focused}
            onClick={() => onToggle(w.id)}
          >
            {w.title}
          </button>
        ))}
      </div>
      <div className="taskbar__tray">
        <span title={`Chain ${BASE.id}`}>{BASE.name}</span>
        <span className="mono" title="No key is held by this site">
          no key held
        </span>
        <WalletStatus />
        <SoundToggle />
        <BlockClock onOpen={onOpenFeature ? () => onOpenFeature("taskmgr") : undefined} />
      </div>
    </nav>
  );
}
