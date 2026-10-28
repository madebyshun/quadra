import { describe as suite, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt } from "./helpers";
import { recognize, describe as explain } from "@/lib/verify";
import { USDC } from "@/config/chain";

const TX = `0x${"a".repeat(64)}`;

suite("recognize", () => {
  it("calls an empty string empty, including whitespace only", () => {
    expect(recognize("").kind).toBe("empty");
    expect(recognize("   \n\t ").kind).toBe("empty");
  });

  it("recognizes a 32-byte transaction hash", () => {
    expect(recognize(TX)).toEqual({ kind: "txHash", value: TX });
  });

  it("recognizes a 20-byte address, and does not call it a transaction", () => {
    expect(recognize(USDC.address)).toEqual({
      kind: "address",
      value: USDC.address,
      checksum: { kind: "checksummed", address: USDC.address.toLowerCase() },
    });
  });

  /**
   * ⚠️ **The reason `recognize` classifies on shape and not on the checksum.** A
   * bad-checksum string still IS an address, and this box exists to name what you pasted.
   * Calling it `unrecognized` would hide the one mistake somebody opens this page to find,
   * and would also be false. The verdict rides along instead, so the page can say both
   * things: this is an address, and something is wrong with it.
   */
  it("still calls a bad-checksum string an address, and reports the mismatch", () => {
    const typo = USDC.address.replace("0x833589", "0x833589").replace("913", "914");
    const found = recognize(typo);
    expect(found.kind).toBe("address");
    if (found.kind !== "address") throw new Error("unreachable");
    expect(found.checksum.kind).toBe("mismatch");
  });

  it("reports a lowercase address as unchecked rather than as verified", () => {
    const found = recognize(USDC.address.toLowerCase());
    if (found.kind !== "address") throw new Error("unreachable");
    expect(found.checksum.kind).toBe("unchecked");
  });

  it("does not confuse the two lengths", () => {
    expect(recognize(`0x${"a".repeat(63)}`).kind).toBe("unrecognized");
    expect(recognize(`0x${"a".repeat(65)}`).kind).toBe("unrecognized");
    expect(recognize(`0x${"a".repeat(39)}`).kind).toBe("unrecognized");
    expect(recognize(`0x${"a".repeat(41)}`).kind).toBe("unrecognized");
  });

  it("accepts either case of hex, since explorers print both", () => {
    expect(recognize(TX.toUpperCase().replace("0X", "0x")).kind).toBe("txHash");
    expect(recognize(USDC.address.toLowerCase()).kind).toBe("address");
  });

  it("rejects hex without the 0x prefix", () => {
    expect(recognize("a".repeat(64)).kind).toBe("unrecognized");
  });

  it("rejects non-hex characters at the right length", () => {
    expect(recognize(`0x${"z".repeat(64)}`).kind).toBe("unrecognized");
  });

  /**
   * This site's notes used to be recognised by their prefix. The privacy model that made
   * them was archived on 2026-09-30, so a note string is now just text — naming it would
   * claim a kind of thing this build no longer has.
   */
  it("no longer claims a note string as its own", () => {
    expect(recognize("quadra-note-v1:abc").kind).toBe("unrecognized");
  });

  it("trims before deciding, since pasting picks up whitespace", () => {
    expect(recognize(`  ${TX}  `)).toEqual({ kind: "txHash", value: TX });
  });

  it("calls anything else unrecognized rather than guessing", () => {
    for (const junk of ["hello", "https://basescan.org/tx/0xabc", "1234", "0x"]) {
      expect(recognize(junk).kind, junk).toBe("unrecognized");
    }
  });
});

suite("describe", () => {
  it("has a line for every kind", () => {
    /**
     * The `address` arm is built through `recognize` rather than by hand, because it now
     * carries a `checksum` whose value has to be real — a fabricated one would let this
     * test pass against a `describe` that reads a field nothing ever sets.
     */
    const cases: ReturnType<typeof recognize>[] = [
      { kind: "empty" },
      { kind: "txHash", value: "x" },
      recognize(USDC.address),
      { kind: "unrecognized", value: "x" },
    ];
    for (const found of cases) {
      expect(explain(found).length, found.kind).toBeGreaterThan(0);
    }
    expect(new Set(cases.map((c) => c.kind)).size).toBe(4);
  });

  /**
   * ⚠️ The checksum verdict is appended to the address line rather than replacing it,
   * because the two facts answer different questions and a user pasting an address into a
   * transaction box needs both: "this is not the transaction" and "this may be mistyped".
   */
  it("appends the checksum verdict to the address line", () => {
    const verified = explain(recognize(USDC.address));
    const unchecked = explain(recognize(USDC.address.toLowerCase()));
    expect(verified).toContain("That is an address, not a transaction.");
    expect(unchecked).toContain("That is an address, not a transaction.");
    expect(verified).toContain("EIP-55 checksum matches.");
    expect(unchecked).toContain("no EIP-55 checksum to verify");
    expect(verified).not.toBe(unchecked);
  });

  it("tells you an address is not a transaction, rather than just naming it", () => {
    expect(explain(recognize(USDC.address))).toMatch(/not a transaction/);
  });
});

suite("the Verify page", () => {
  it("starts with nothing checked", () => {
    renderAt("/verify");
    expect(screen.getByLabelText("Result")).toHaveTextContent("// nothing checked yet");
  });

  it("cannot be checked while the box is empty", () => {
    renderAt("/verify");
    expect(screen.getByRole("button", { name: "Check it" })).toBeDisabled();
  });

  it("names what you pasted when you check it", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(screen.getByLabelText("Result")).toHaveTextContent("That is a transaction hash");
  });

  it("no longer renders the same thing before and after the click", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    const before = screen.getByLabelText("Result").textContent;
    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(screen.getByLabelText("Result").textContent).not.toBe(before);
  });

  it("links a hash to the explorer so you can read it there", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    const link = screen.getByRole("link", { name: "Open it on Basescan" });
    expect(link).toHaveAttribute("href", `https://basescan.org/tx/${TX}`);
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  /**
   * The page names the shape and hands the question of what the transaction DID to the
   * explorer and the `tx` skill, rather than looking like it checked something itself.
   */
  it("points at the explorer and the Terminal instead of claiming to have checked", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    const out = screen.getByLabelText("Result");
    expect(out).toHaveTextContent("this page is not the authority");
    expect(out).toHaveTextContent("type `tx <hash>` in the Terminal");
  });

  it("corrects you when you paste an address", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), USDC.address);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(screen.getByLabelText("Result")).toHaveTextContent("not a transaction");
    expect(screen.queryByRole("link", { name: "Open it on Basescan" })).not.toBeInTheDocument();
  });

  it("does not pretend to recognize junk", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), "definitely not a hash");
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(screen.getByLabelText("Result")).toHaveTextContent(
      "That is not a transaction hash or an address.",
    );
  });

  it("clears back to the starting state", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Result")).toHaveTextContent("// nothing checked yet");
    expect(screen.getByLabelText(/Transaction hash/)).toHaveValue("");
  });

  it("has nothing to clear before you type", () => {
    renderAt("/verify");
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });
});
