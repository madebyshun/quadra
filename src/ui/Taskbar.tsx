import { BRAND } from "@/brand";
import { BASE } from "@/config/chain";

export type TaskbarProps = {
  /** null on the desktop, the open window's title otherwise */
  openWindow: string | null;
  onStart: () => void;
};

export function Taskbar({ openWindow, onStart }: TaskbarProps) {
  return (
    <nav className="taskbar" aria-label="Taskbar">
      <button type="button" className="taskbar__start" onClick={onStart}>
        {BRAND.name}
      </button>
      {openWindow ? (
        <span className="chip" aria-current="true">
          {openWindow}
        </span>
      ) : null}
      <div className="taskbar__tray">
        <span title={`Chain ${BASE.id}`}>{BASE.name}</span>
        <span className="mono" title="No key is held by this site">
          no key held
        </span>
      </div>
    </nav>
  );
}
