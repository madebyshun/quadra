/**
 * The shape every on-chain skill answers in.
 *
 * A skill is written once and reached three ways: a window on the desktop, a line in the
 * Terminal, and (next) an MCP tool an agent calls. So it answers in DATA — a `Report` —
 * and each surface renders that data its own way. A skill that returned JSX could not
 * be typed into a terminal; one that returned a string could not be laid out as a table.
 *
 * ── The one rule every report keeps ──────────────────────────────────────────
 * `sources` names where every number came from, and a value this build could not read
 * says so ("not checked") rather than being left out. A security scan that silently
 * omits the flags it could not fetch reads as a clean scan; that is the most dangerous
 * thing a panel like this can print, so a missing answer is a row, not an absence.
 */

export type Tone = "ok" | "warn" | "bad";

export type Row = {
  readonly label: string;
  readonly value: string;
  /** colour for a verdict — omitted for plain facts */
  readonly tone?: Tone;
  /** where to see it for yourself: an explorer page, the source */
  readonly href?: string;
  /**
   * What to do next about THIS row, as a command line (`profile 0x…`, `verdict 0x…`) — the same line
   * the Terminal takes, so a button in a window and a typed command cannot disagree (2026-10-02, the
   * owner: "link everything together"). An app action, not part of what an agent reads over MCP.
   */
  readonly next?: string;
};

/** A next step for the whole report: a label for the button, and the command line it runs. */
export type Step = { readonly label: string; readonly command: string };

export type Report = {
  readonly title: string;
  readonly rows: readonly Row[];
  /** sentences under the table: caveats, what was not checked, what a verdict does not mean */
  readonly notes: readonly string[];
  /** every service a number above came from, by name */
  readonly sources: readonly string[];
  /** where to go from here — run in the app (a window or the Terminal), never sent to an agent */
  readonly next?: readonly Step[];
};

export type SkillArg = {
  readonly name: string;
  /** what to type, for the form placeholder and the Terminal's help */
  readonly hint: string;
  readonly optional?: boolean;
};

export type Skill = {
  /** the Terminal command, lowercase */
  readonly id: string;
  readonly title: string;
  /** one line: what it answers */
  readonly summary: string;
  readonly args: readonly SkillArg[];
  run(args: readonly string[]): Promise<Report>;
};

/** A row, with `tone`/`href` only when given — `exactOptionalPropertyTypes` will not take `undefined`. */
export function row(label: string, value: string, extra: { tone?: Tone; href?: string; next?: string } = {}): Row {
  return { label, value, ...extra };
}
