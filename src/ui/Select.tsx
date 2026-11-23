import { useEffect, useRef, useState } from "react";

export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type SelectGroup = {
  readonly label: string;
  readonly options: readonly SelectOption[];
};

export function QuadraSelect({
  ariaLabel,
  value,
  onChange,
  options,
  groups,
  disabled = false,
  className = "",
}: {
  readonly ariaLabel?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options?: readonly SelectOption[];
  readonly groups?: readonly SelectGroup[];
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const allOptions = groups ? groups.flatMap((g) => g.options) : (options ?? []);
  const selected = allOptions.find((o) => o.value === value) ?? allOptions[0];

  const pick = (next: string) => {
    setOpen(false);
    onChange(next);
  };

  return (
    <div className={`qselect${className ? ` ${className}` : ""}`} ref={rootRef}>
      <select
        className="sr-only"
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => pick(e.target.value)}
      >
        {groups
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))
          : (options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </select>
      <button
        type="button"
        className="field qselect__btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="qselect__val">{selected?.label ?? value}</span>
        <span className="qselect__caret" aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div className="menu qselect__dropdown" role="listbox" aria-label={ariaLabel ? `${ariaLabel} options` : "Options"}>
          {groups
            ? groups.map((g, gi) => (
                <div key={g.label} className={gi > 0 ? "menu__group" : undefined}>
                  <div className="qselect__head">{g.label}</div>
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={o.value === value}
                      className="menu__item qselect__item"
                      onClick={() => pick(o.value)}
                    >
                      <span>{o.label}</span>
                    </button>
                  ))}
                </div>
              ))
            : (options ?? []).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className="menu__item qselect__item"
                  onClick={() => pick(o.value)}
                >
                  <span>{o.label}</span>
                </button>
              ))}
        </div>
      ) : null}
    </div>
  );
}
