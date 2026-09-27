import type { ButtonHTMLAttributes, ReactNode } from "react";

export type GelProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  /** graphite instead of aqua blue — for the secondary action */
  quiet?: boolean;
};

export function Gel({ children, quiet, className, type, ...rest }: GelProps) {
  const cls = ["gel", quiet ? "gel--quiet" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type ?? "button"} className={cls} {...rest}>
      {children}
    </button>
  );
}
