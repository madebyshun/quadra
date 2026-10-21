import { useOpenWindow } from "@/features/openWindow";
import { comingSoon } from "@/features/registry";
import { Icon } from "@/ui/icons";

/**
 * The Coming Soon folder: programs that are built or stubbed but switched off. They used to sit on
 * the desktop dimmed, saying "not switched on yet" three times over; here they wait in a folder,
 * still openable (each says it is off), and the desktop is left to what works.
 */
export function SoonPanel() {
  const open = useOpenWindow();
  const waiting = comingSoon();
  if (waiting.length === 0) return <p className="dim">Everything is out of the box. Nothing is waiting.</p>;
  return (
    <div className="stack">
      <ul className="folder" aria-label="Programs not switched on yet">
        {waiting.map((f) => (
          <li key={f.id}>
            <button type="button" className="folder__item icon--off" onClick={() => open?.(f.id)}>
              <span className="icon__glyph">
                <Icon id={f.id} />
              </span>
              <span className="icon__title">{f.title}</span>
              <span className="icon__blurb">{f.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="dim">Still in the box: switched off, so nothing in them runs or moves money. Each one opens to say so.</p>
    </div>
  );
}
