import type { ReactNode } from "react";

export type WindowProps = {
  title: string;
  children: ReactNode;
  /** when given, the three lights are live and Esc closes */
  onClose?: () => void;
};

/**
 * An XP Luna window frame wearing Aqua traffic lights. Minimise and zoom are
 * drawn but inert: this app has one window at a time, so there is nowhere to
 * minimise to. They are marked disabled rather than removed, because the frame
 * reads wrong without all three.
 */
export function Window({ title, children, onClose }: WindowProps) {
  return (
    <section className="win" aria-label={title}>
      <div className="win__bar">
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
            disabled
            aria-label="Minimise (not available)"
            tabIndex={-1}
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
    </section>
  );
}
