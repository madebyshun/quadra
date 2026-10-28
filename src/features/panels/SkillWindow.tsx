import { useEffect, useState } from "react";
import { messageOf } from "@/lib/errors";
import type { Report, Skill } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { ReportView } from "@/features/panels/ReportView";
import { parseCommand, runKey } from "@/features/commands";
import { useInbox } from "@/features/openWindow";
import type { WindowId } from "@/features/registry";

/**
 * One form per skill, and the tabs that switch between them.
 *
 * The form is generated from the skill's own `args`, so a window and the Terminal can
 * never disagree about what a skill takes: add an argument to the skill and both surfaces
 * have it. `key={skill.id}` resets the form when the tab changes — an address typed for
 * "Wallet" must not quietly become the input of "Token scan".
 */

export function SkillForm({ skill, preset }: { skill: Skill; preset?: readonly string[] }) {
  /** One entry per argument, from the first render on — hence the `!` on every read below. */
  const [values, setValues] = useState<string[]>(() => skill.args.map((_, i) => preset?.[i] ?? ""));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Required arguments filled in — the button says what is missing rather than failing on click. */
  const missing = skill.args.find((a, i) => !a.optional && values[i]!.trim() === "");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      /**
       * Joined and split exactly as a Terminal line is, so a form and a typed command reach
       * the skill with the same arguments — "space-separated" in a field means the same
       * thing it means at the prompt, and an empty optional field simply is not there.
       */
      setReport(await skill.run(values.join(" ").trim().split(/\s+/).filter(Boolean)));
    } catch (e) {
      setReport(null);
      setError(messageOf(e));
    }
    setBusy(false);
  };

  // a command another window sent (a report's next step): filled in above, and run at once
  useEffect(() => {
    if (preset) void run();
    // once, for the preset this form was made with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack">
      <p className="dim">{skill.summary}</p>
      {skill.args.map((arg, i) => (
        <label className="group__row" key={arg.name}>
          <span>
            {arg.name}
            {arg.optional ? " — optional" : ""}
          </span>
          <input
            className="field"
            value={values[i]!}
            placeholder={arg.hint}
            aria-label={arg.name}
            spellCheck={false}
            onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !missing && !busy) void run();
            }}
          />
        </label>
      ))}
      <Gel className="mf__cta" onClick={() => void run()} disabled={busy || missing !== undefined}>
        {busy ? "Reading…" : missing ? `Enter ${missing.name}` : skill.args.length ? "Look up" : "Check now"}
      </Gel>
      {error ? (
        <Crt label={`${skill.title} error`}>
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : report ? (
        <ReportView report={report} />
      ) : null}
    </div>
  );
}

export function SkillWindow({ skills, label, window }: { skills: readonly Skill[]; label: string; window: WindowId }) {
  const [selected, setSelected] = useState(0);
  /** a command sent here to run: which run it is, so the form is made afresh, and its arguments */
  const [preset, setPreset] = useState<{ readonly n: number; readonly args: readonly string[] } | null>(null);
  useInbox(runKey(window), (line) => {
    const c = parseCommand(line);
    const i = c.kind === "skill" ? skills.findIndex((s) => s.id === c.skill.id) : -1;
    if (i < 0) return;
    setSelected(i);
    setPreset((p) => ({ n: (p?.n ?? 0) + 1, args: (c as { args: readonly string[] }).args }));
  });
  const skill = skills[selected] as Skill;
  return (
    <div className="stack">
      {skills.length > 1 ? (
        <div className="group__row group__row--actions" role="group" aria-label={label}>
          {skills.map((s, i) => (
            <button
              type="button"
              key={s.id}
              className="chip chip--mode"
              aria-pressed={i === selected}
              onClick={() => (setSelected(i), setPreset(null))}
            >
              {s.title}
            </button>
          ))}
        </div>
      ) : null}
      <SkillForm skill={skill} key={`${skill.id}:${preset?.n ?? 0}`} {...(preset ? { preset: preset.args } : {})} />
    </div>
  );
}
