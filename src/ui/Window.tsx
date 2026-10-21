import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

/** Present only for a window on the multi-window desktop; absent for the static, one-at-a-time pages (`Page.tsx`). */
export type WindowLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** false while minimised: the window stays mounted (so its own state survives) but is not shown or hit-testable */
  visible: boolean;
  onFocus: () => void;
  onMinimize: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
};

export type WindowProps = {
  title: string;
  children: ReactNode;
  /** when given, the close light is live and Esc closes */
  onClose?: () => void;
  layout?: WindowLayout;
};

type DragOrigin = { mouseX: number; mouseY: number; startX: number; startY: number };

/**
 * An XP Luna window frame wearing Aqua traffic lights.
 *
 * With no `layout`, this is the static single-window frame `Page.tsx` uses for
 * `/docs`, `/api`, `/verify` and 404 — centred by the caller's `.shell`, minimise
 * and zoom drawn but inert, because a standalone page has nowhere to minimise to.
 *
 * With `layout`, this is a window on the multi-window desktop: positioned,
 * draggable by its title bar, resizable from its corner grip, and minimise
 * actually hides it to the taskbar rather than doing nothing. Zoom stays inert
 * either way — there is no maximised-to-fullscreen state in this design.
 */
export function Window({ title, children, onClose, layout }: WindowProps) {
  const drag = useRef<DragOrigin | null>(null);
  const resize = useRef<DragOrigin | null>(null);

  const beginDrag = useCallback(
    (e: ReactMouseEvent) => {
      if (!layout) return;
      if ((e.target as HTMLElement).closest(".light")) return;
      layout.onFocus();
      drag.current = { mouseX: e.clientX, mouseY: e.clientY, startX: layout.x, startY: layout.y };
    },
    [layout],
  );

  // No `!layout` guard here, unlike `beginDrag`: the resize grip only renders when
  // `layout` is set (see the JSX below), so this handler can never fire without one.
  const beginResize = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      layout!.onFocus();
      resize.current = { mouseX: e.clientX, mouseY: e.clientY, startX: layout!.width, startY: layout!.height };
    },
    [layout],
  );

  useEffect(() => {
    if (!layout) return;
    const { onMove, onResize } = layout;
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (drag.current) {
        const { mouseX, mouseY, startX, startY } = drag.current;
        onMove(startX + (e.clientX - mouseX), Math.max(0, startY + (e.clientY - mouseY)));
      }
      if (resize.current) {
        const { mouseX, mouseY, startX, startY } = resize.current;
        onResize(startX + (e.clientX - mouseX), startY + (e.clientY - mouseY));
      }
    };
    const onMouseUp = () => {
      drag.current = null;
      resize.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [layout]);

  const style = layout
    ? {
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        zIndex: layout.zIndex,
        display: layout.visible ? undefined : "none",
      }
    : undefined;

  return (
    <section
      className={layout ? "win win--floating" : "win"}
      aria-label={title}
      style={style}
      onMouseDown={layout?.onFocus}
    >
      <div className="win__bar" onMouseDown={beginDrag}>
        <div className="win__lights">
          <button
            type="button"
            className="light light--close"
            onClick={onClose}
            disabled={!onClose}
            aria-label="Close"
            title="Close"
          />
          <button
            type="button"
            className="light light--min"
            onClick={layout?.onMinimize}
            disabled={!layout}
            aria-label={layout ? "Minimise" : "Minimise (not available)"}
            title={layout ? "Minimise" : undefined}
            tabIndex={layout ? undefined : -1}
          />
          <button
            type="button"
            className="light light--max"
            disabled
            aria-label="Zoom (not available)"
            tabIndex={-1}
          />
        </div>
        <h2 className="win__title">{title}</h2>
      </div>
      <div className="win__body">{children}</div>
      {layout ? (
        <div className="win__resize" onMouseDown={beginResize} aria-hidden="true" />
      ) : null}
    </section>
  );
}
