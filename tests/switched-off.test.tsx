import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderAt, settle } from "./helpers";

/**
 * 🔴 "Off, not deleted" is a claim, and this is the evidence for it.
 *
 * `hooks` was switched off on 2026-09-29 and `inference` on 2026-09-30, both because they
 * are not part of the product as positioned — not because they are broken — and CLAUDE.md
 * promises that turning one back on is one line in `FLAGS`. That promise rots silently:
 * with the flag off, nothing renders `BUILT.hooks` or `BUILT.inference`, so either panel
 * could stop mounting and every other test would stay green. This file turns the flags back
 * on in a mocked config and opens the windows, so the day someone flips one they get the
 * panel the owner switched off, not a surprise.
 */
vi.mock("@/config/chain", async (original) => {
  const real = await original<typeof import("@/config/chain")>();
  return { ...real, FLAGS: { ...real.FLAGS, hooks: true, inference: true, audit: true, robinhood: true } };
});

describe("a switched-off window, switched back on", () => {
  it("opens the real Hooks panel with one flag flipped and nothing else changed", async () => {
    renderAt("/?do=hooks");
    await settle();
    expect(screen.queryByLabelText("Hooks is off")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hooks is not built yet")).not.toBeInTheDocument();
    expect(screen.getByText("// paste a hook address")).toBeInTheDocument();
  });

  /** Robinhood Chain was hidden on 2026-10-02 ("Base first"); its Bridge comes back whole with one flag. */
  it("opens the real Bridge panel once Robinhood Chain is switched on", async () => {
    renderAt("/?do=bridge");
    await settle();
    expect(screen.queryByLabelText("Bridge is off")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Move")).toBeInTheDocument();
  });

  it("opens the real Inference panel the same way", async () => {
    renderAt("/?do=inference");
    await settle();
    expect(screen.queryByLabelText("Inference is off")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("quadra-small");
  });

  /**
   * Audit has no panel at all, so switching it on is the one way left to see the not-built
   * notice render — "off" and "not built" are different facts, and a flag being on must
   * never be enough to make a window look ready.
   */
  it("says a switched-on window with nothing behind it is unbuilt, rather than showing a blank", async () => {
    renderAt("/?do=audit");
    await settle();
    expect(screen.getByLabelText("Audit is not built yet")).toHaveTextContent(
      /switched on but not built yet.*nothing here will move money\.$/i,
    );
  });
});
