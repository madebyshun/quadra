import { useEffect, useRef, useState } from "react";
import { messageOf } from "@/lib/errors";
import { helpText, reportText } from "@/skills";
import type { Report, Step } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { parseCommand, runKey, windowsText } from "@/features/commands";
import { useInbox, useOpenWindow } from "@/features/openWindow";
import { windowTitle } from "@/features/registry";

/**
 * Every skill, typed — and every window: `coin 0x…`, `profile name`, `send 0x…`, `open markets`
 * (2026-10-02: one command language for the whole app, `features/commands.ts`). `help` lists both;
 * `clear` empties the screen.
 *
 * A skill's output is the same `reportText` an agent reads over MCP, so what a person sees here is
 * what an agent is told. Under it, the report's next steps are buttons that type and run their own
 * command. Lines are kept in order with the command that produced them, and a command's answer
 * lands under it even when a later command finished first.
 */

type Entry = { readonly id: number; readonly command: string; readonly output: string | null; readonly failed: boolean; readonly next: readonly Step[] };

const WELCOME = "Type a command. `help` lists them — try `radar`, `verdict 0x…` before you buy, or `coins` to open a window.";
/** At most this many next steps under one answer. */
export const NEXT_SHOWN = 6;

/** A report's next steps: its own, then its rows' — each command once. */
export function nextSteps(report: Report): Step[] {
  const all = [...(report.next ?? []), ...report.rows.flatMap((r) => (r.next ? [{ label: r.next, command: r.next }] : []))];
  return all.filter((s, i) => all.findIndex((x) => x.command === s.command) === i).slice(0, NEXT_SHOWN);
}

export function TerminalPanel() {
  const [line, setLine] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const next = useRef(0);
  const screen = useRef<HTMLDivElement>(null);
  const open = useOpenWindow();

  /** Keep the newest output in view, the way a terminal scrolls. Effects run after mount, so the ref is set. */
  useEffect(() => {
    const el = screen.current!;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const settle = (id: number, output: string, failed: boolean, steps: readonly Step[] = []) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, output, failed, next: steps } : e)));
  const say = (command: string, output: string, failed = false) => {
    const id = next.current++;
    setEntries((prev) => [...prev, { id, command, output, failed, next: [] }]);
  };

  const submit = (command: string) => {
    setLine("");
    const parsed = parseCommand(command);
    if (parsed.kind === "empty") return;
    if (parsed.kind === "clear") return setEntries([]);
    if (parsed.kind === "help") return say(command, `${helpText()}\n\nWindows — open one from here:\n${windowsText()}`);
    if (parsed.kind === "windows") return say(command, windowsText());
    if (parsed.kind === "say") return say(command, parsed.text);
    if (parsed.kind === "unknown") return say(command, `No command "${parsed.word}". Type help for the list.`, true);
    if (parsed.kind === "off") return say(command, `${parsed.title} is not switched on.`, true);
    if (parsed.kind === "open") {
      if (!open) return say(command, "Windows open from the desktop; this Terminal is on its own here.", true);
      open(parsed.opening.window, parsed.opening.params);
      return say(command, `Opened ${windowTitle(parsed.opening.window)}.`);
    }
    const id = next.current++;
    setEntries((prev) => [...prev, { id, command, output: null, failed: false, next: [] }]);
    parsed.skill.run(parsed.args).then(
      (report) => settle(id, reportText(report), false, nextSteps(report)),
      (e: unknown) => settle(id, messageOf(e), true),
    );
  };

  // a command another window sent here to run (`launch …` from a report, say)
  useInbox(runKey("terminal"), submit);

  return (
    <div className="stack">
      <Crt label="Terminal output">
        <div className="terminal" ref={screen}>
          <span className="crt__dim">{WELCOME}</span>
          {entries.map((e) => (
            <div key={e.id}>
              <span className="terminal__prompt">&gt; {e.command}</span>
              {e.output === null ? (
                <span className="crt__dim">reading…</span>
              ) : (
                <span className={`crt__pre${e.failed ? " crt__amber" : ""}`}>{e.output}</span>
              )}
              {e.next.length ? (
                <span className="terminal__next" role="group" aria-label={`Next after ${e.command}`}>
                  {e.next.map((s) => (
                    <button key={s.command} type="button" className="terminal__step" title={s.command} onClick={() => submit(s.command)}>
                      ↳ {s.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </Crt>
      <label className="terminal__line">
        <span className="mono">&gt;</span>
        <input
          className="field mono"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(line);
          }}
          aria-label="Command"
          placeholder="help"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
    </div>
  );
}
