import { useState, type KeyboardEvent } from "react";
import { useOpenWindow } from "@/features/openWindow";
import { comingSoon, entryOf, folderItems, type Entry, type FolderId } from "@/features/registry";
import { Icon } from "@/ui/icons";
import { BASE } from "@/config/chain";

/**
 * A folder, the way the Mac OS 8 Finder drew one (2026-10-22; an Explorer window before): an info
 * line under the title bar (how many items, on which chain — the Finder's "disk / available"), a
 * grid of icons with labels, a status line. One click selects, a double click or Enter opens — the
 * program's own window, by the same id a `?do=` link uses. The info line is furniture, not controls.
 */
export function Explorer({ label, items, dim = false, empty }: { label: string; items: readonly Entry[]; dim?: boolean; empty: string }) {
  const open = useOpenWindow();
  const [selected, setSelected] = useState<string | null>(null);
  const picked = items.find((e) => e.id === selected) ?? null;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, entry: Entry) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    open?.(entry.id);
  };
  return (
    <div className="explorer">
      <div className="explorer__menu" aria-hidden="true">
        <span>
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        <span>on {BASE.name}</span>
        <span>no key held</span>
      </div>
      {items.length === 0 ? (
        <p className="explorer__empty">{empty}</p>
      ) : (
        <ul className="explorer__grid" aria-label={label}>
          {items.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`explorer__item ${dim ? "icon--off" : ""}`}
                aria-pressed={e.id === selected}
                title={e.blurb}
                onClick={() => setSelected(e.id)}
                onDoubleClick={() => open?.(e.id)}
                onKeyDown={(k) => onKey(k, e)}
              >
                <span className="icon__glyph">
                  <Icon id={e.id} />
                </span>
                <span className="explorer__label">{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="explorer__status" role="status">
        <span>
          {items.length} object{items.length === 1 ? "" : "s"}
        </span>
        <span className="explorer__blurb">{picked ? `${picked.title} — ${picked.blurb}` : "Double-click to open"}</span>
      </div>
    </div>
  );
}

export function FolderPanel({ id }: { id: FolderId }) {
  return <Explorer label={entryOf(id).title} items={folderItems(id)} empty="This folder is empty." />;
}

/**
 * The Coming Soon folder: programs that are built or stubbed but switched off. They wait here,
 * still openable (each says it is off), and the desktop is left to what works.
 */
export function SoonPanel() {
  return (
    <Explorer
      label="Programs not switched on yet"
      items={comingSoon().map((f) => entryOf(f.id))}
      dim
      empty="Everything is out of the box. Nothing is waiting."
    />
  );
}
