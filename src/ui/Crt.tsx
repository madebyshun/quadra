import type { ReactNode } from "react";

export type CrtProps = {
  children: ReactNode;
  /** screen-reader label, since a CRT panel is usually raw hex or a proof */
  label?: string;
};

/** The phosphor panel: anything the machine produced and the user should be able to read back. */
export function Crt({ children, label }: CrtProps) {
  return (
    <div className="crt" role="group" aria-label={label ?? "output"}>
      {children}
    </div>
  );
}
