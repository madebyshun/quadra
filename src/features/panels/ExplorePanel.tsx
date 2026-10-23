import { useState, type KeyboardEvent, type ReactNode } from "react";
import { BRAND } from "@/brand";
import { appsIn, BASE_APPS, domainOf, ECOSYSTEM_READ, ECOSYSTEM_SOURCE, FOLDERS_OF_BASE, type BaseApp, type FolderKey } from "@/config/baseApps";
import "./ExplorePanel.css";

/**
 * Explore Base (2026-10-22, the owner, after solana95.com's "Solana Directory"): a folder of folders,
 * each holding projects on Base as `<name>.exe` icons. One click selects, a double click or Enter
 * "runs" one — which only ever opens a small dialog saying where the link goes; the site itself opens
 * from that dialog's Open, in a new window, with no opener and no referrer. The list is base.org's own
 * (config/baseApps.ts); "Add yours.exe" says how to get on it, and sends nothing anywhere.
 */

type Dialog = { readonly kind: "app"; readonly app: BaseApp } | { readonly kind: "add" };

function Glyph() {
  // a generic program icon: a window with a title bar, for a logo that is missing or will not load
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" fill="#fff" stroke="currentColor" />
      <rect x="2.5" y="4.5" width="19" height="4" fill="currentColor" />
    </svg>
  );
}

function Logo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Glyph />;
  return <img className="explore__logo" src={src} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      <path d="M2.5 6.5h7l2 2h10v11h-19z" fill="#f4d36b" stroke="#8a6d1b" />
    </svg>
  );
}

type Item = { readonly id: string; readonly label: string; readonly blurb: string; readonly icon: ReactNode; readonly run: () => void };

function Grid({ label, items, status }: { label: string; items: readonly Item[]; status: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const picked = items.find((i) => i.id === selected) ?? null;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, item: Item) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    item.run();
  };
  return (
    <>
      <ul className="explorer__grid" aria-label={label}>
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              className="explorer__item"
              aria-pressed={i.id === selected}
              title={i.blurb}
              onClick={() => setSelected(i.id)}
              onDoubleClick={i.run}
              onKeyDown={(k) => onKey(k, i)}
            >
              <span className="icon__glyph">{i.icon}</span>
              <span className="explorer__label">{i.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="explorer__status" role="status">
        <span>{status}</span>
        <span className="explorer__blurb">{picked ? `${picked.label} — ${picked.blurb}` : "Double-click to open"}</span>
      </div>
    </>
  );
}

function AppDialog({ app, onClose }: { app: BaseApp; onClose: () => void }) {
  const domain = domainOf(app.url);
  return (
    <div className="explore__dialog" role="dialog" aria-label={`${app.name}.exe`}>
      <p className="explore__dialog-title">{app.name}.exe</p>
      <div className="explore__dialog-body">
        <Logo src={app.logo} />
        <div>
          <p>
            <strong>{app.name}.exe</strong> — {app.line}
          </p>
          <p>
            {app.name}.exe wants to open <strong>{domain}</strong> in a new window.
          </p>
        </div>
      </div>
      <div className="explore__dialog-actions">
        <a className="gel" href={app.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Open
        </a>
        <button type="button" className="gel gel--quiet" onClick={onClose} autoFocus>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="explore__dialog" role="dialog" aria-label="Add yours.exe">
      <p className="explore__dialog-title">Add yours.exe</p>
      <div className="explore__dialog-body">
        <Glyph />
        <div>
          <p>
            This folder is read from base.org&apos;s own ecosystem list. Get your project listed there first — a pull request to the{" "}
            <code>base/web</code> repository on GitHub — then tell us on X at <strong>{BRAND.x}</strong>.
          </p>
          <p className="dim">Nothing is sent from here: there is no form, and this window asks you for nothing.</p>
        </div>
      </div>
      <div className="explore__dialog-actions">
        <button type="button" className="gel" onClick={onClose} autoFocus>
          OK
        </button>
      </div>
    </div>
  );
}

export function ExplorePanel() {
  const [folder, setFolder] = useState<FolderKey | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const here = folder ? FOLDERS_OF_BASE.find((f) => f.key === folder)! : null;

  const items: readonly Item[] = here
    ? [
        ...appsIn(here.key).map((a) => ({
          id: a.name,
          label: `${a.name}.exe`,
          blurb: a.line,
          icon: <Logo src={a.logo} />,
          run: () => setDialog({ kind: "app", app: a }),
        })),
        { id: "add-yours", label: "Add yours.exe", blurb: "how to get a project in here", icon: <Glyph />, run: () => setDialog({ kind: "add" }) },
      ]
    : FOLDERS_OF_BASE.map((f) => ({
        id: f.key,
        label: f.title,
        blurb: f.blurb,
        icon: <FolderGlyph />,
        run: () => setFolder(f.key),
      }));

  return (
    <div className="explorer explore">
      <div className="explore__bar">
        <button type="button" className="chip" disabled={!here} onClick={() => setFolder(null)}>
          ↑ Up
        </button>
        <span className="explore__path">Explore Base{here ? ` \\ ${here.title}` : ""}</span>
      </div>
      <Grid
        key={folder ?? "root"}
        label={here ? here.title : "Explore Base"}
        items={items}
        status={here ? `${items.length - 1} programs` : `${FOLDERS_OF_BASE.length} folders · ${BASE_APPS.length} programs`}
      />
      <p className="explore__source dim">
        From{" "}
        <a href={ECOSYSTEM_SOURCE} target="_blank" rel="noopener noreferrer">
          base.org&apos;s ecosystem list
        </a>
        , read {ECOSYSTEM_READ}. Listed is not vetted: check a site before you connect a wallet to it.
      </p>
      {dialog ? (
        <div className="explore__veil" onKeyDown={(e) => e.key === "Escape" && close()}>{dialog.kind === "app" ? <AppDialog app={dialog.app} onClose={close} /> : <AddDialog onClose={close} />}</div>
      ) : null}
    </div>
  );
}
