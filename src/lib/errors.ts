/**
 * What went wrong, as the sentence a person reads.
 *
 * One named function rather than `e instanceof Error ? e.message : String(e)` at every
 * catch. The inline form has a branch that most call sites can never reach — the code
 * inside the `try` only ever throws `Error` — and an unreachable branch is not free in a
 * repo pinned at 100%: the honest ways to cover it are a contrived throw or a test that
 * fakes a state the app cannot enter. One function with two plain tests is the same
 * coverage and a true statement. (Moved here from the archived `transaction.ts`.)
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
