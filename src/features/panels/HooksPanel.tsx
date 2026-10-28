import { useMemo, useState } from "react";
import { describeChecksum } from "@/lib/address";
import { hookAddressProblem, readHookAddress, type HookReading } from "@/lib/hooks";
import { Crt } from "@/ui/Crt";

/**
 * Paste a hook address, see what the pool will let it do.
 *
 * This is the one panel with no adapter behind it, because it needs none: the
 * answer is in the address. Nothing is fetched, nothing is paid, and the result
 * is the same for everyone — which is exactly why it is worth showing.
 *
 * Every permission is listed, granted or not. Showing only the granted ones would
 * read as a short list of scary powers with no sense of what was NOT given, and
 * the absent ones are the reassuring half of the answer.
 */

export function HooksPanel() {
  const [text, setText] = useState("");

  /**
   * Checked rather than caught. `readHookAddress` throws — that is right for a
   * caller that has already validated — but catching here would add a
   * non-Error branch that nothing can reach, since the only thrower is one line
   * away and throws an Error every time.
   *
   * ⚠️ `hookAddressProblem` rather than `isHookAddress` because there are now two ways
   * to fail and they need different sentences: "that is not an address" for a paste that
   * is not one, and the EIP-55 sentence for one character being wrong. A single message
   * covering both would tell somebody who mistyped a real address to paste an address.
   */
  const { reading, error } = useMemo((): {
    reading: HookReading | null;
    error: string | null;
  } => {
    if (!text.trim()) return { reading: null, error: null };
    const problem = hookAddressProblem(text);
    if (problem !== null) return { reading: null, error: problem };
    return { reading: readHookAddress(text), error: null };
  }, [text]);

  return (
    <div className="stack">
      <fieldset className="group">
        <legend>Hook address</legend>
        <label className="group__row">
          <span>Address</span>
          <input
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="0x…"
            aria-label="Hook address"
            spellCheck={false}
          />
        </label>
        <p className="dim">
          Read straight out of the address. Nothing is fetched and nothing is paid.
        </p>
      </fieldset>

      <Crt label="Hooks output">
        {error ? (
          <span className="crt__amber">{error}</span>
        ) : reading === null ? (
          <span className="crt__dim">{"// paste a hook address"}</span>
        ) : (
          <>
            <span>
              {reading.inert
                ? "This address carries no hook permissions. The pool will not call it at any point."
                : `The pool will call this hook at ${reading.granted.length} of 14 points.`}
            </span>
            <ul className="notes" aria-label="Hook permissions">
              {reading.permissions.map((p) => (
                <li key={p.name}>
                  <span className={p.granted ? "crt__amber" : "crt__dim"}>
                    {p.granted ? "ON " : "off"} <code>{p.name}</code> — {p.means}
                  </span>
                </li>
              ))}
            </ul>
            {/*
              The checksum line sits with the caveat rather than with the verdict, because
              it qualifies which address was read rather than what was found in it. An
              `inert` reading of a lowercase address is two separate uncertainties and
              collapsing them would hide the weaker one.
            */}
            <span className="crt__dim">{`// ${describeChecksum(reading.checksum)}`}</span>
            <span className="crt__dim">
              {
                "// these bits say which callbacks run, never what they do. A hook with one permission can still take everything in the swap."
              }
            </span>
          </>
        )}
      </Crt>
    </div>
  );
}
