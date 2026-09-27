import { describe as suite, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { renderAt } from "./helpers";
import { BRAND } from "@/brand";
import { recognize, describe as explain, canCheckOnChain } from "@/lib/verify";
import { CONTRACTS, USDC } from "@/config/chain";

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
    expect(recognize(USDC.address)).toEqual({ kind: "address", value: USDC.address });
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

  it("recognizes one of this site's notes by its prefix", () => {
    const note = `${BRAND.notePrefix}abc123`;
    expect(recognize(note)).toEqual({ kind: "note", value: note });
  });

  it("does not claim a note from some other site", () => {
    expect(recognize("othersite-note-v1:abc").kind).toBe("unrecognized");
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
    const kinds = ["empty", "txHash", "address", "note", "unrecognized"] as const;
    for (const kind of kinds) {
      const line = explain(
        kind === "empty" ? { kind } : ({ kind, value: "x" } as ReturnType<typeof recognize>),
      );
      expect(line.length, kind).toBeGreaterThan(0);
    }
  });

  it("tells you an address is not a transaction, rather than just naming it", () => {
    expect(explain(recognize(USDC.address))).toMatch(/not a transaction/);
  });

  it("warns that a note is the money", () => {
    expect(explain(recognize(`${BRAND.notePrefix}x`))).toMatch(/secret|money/i);
  });
});

suite("canCheckOnChain", () => {
  it("is false while the pool is undeployed", () => {
    expect(canCheckOnChain()).toBe(CONTRACTS.shieldedPool !== null);
    expect(canCheckOnChain()).toBe(false);
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

  it("says outright that only the shape was confirmed", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(screen.getByLabelText("Result")).toHaveTextContent(
      /pool is not deployed, so there.*is nothing on chain to check it against/s,
    );
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
      "not a hash, an address, or a note from this site",
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

/**
 * The wording once the pool is live. Mocked rather than waiting for deployment,
 * because "the shape is all this can confirm" must stop being shown the moment
 * a real check becomes possible — and that is not a change anyone would notice
 * by reading the diff that deploys the pool.
 */
suite("the Verify page once the pool is deployed", () => {
  it("drops the not-deployed caveat", async () => {
    vi.resetModules();
    vi.doMock("@/lib/verify", async (orig) => {
      const actual = await orig<typeof import("@/lib/verify")>();
      return { ...actual, canCheckOnChain: () => true };
    });

    const { Verify } = await import("@/pages/Verify");
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Verify />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/Transaction hash/), TX);
    await user.click(screen.getByRole("button", { name: "Check it" }));

    const out = screen.getByLabelText("Result");
    expect(out).toHaveTextContent("That is a transaction hash");
    expect(out).not.toHaveTextContent(/pool is not deployed/);

    vi.doUnmock("@/lib/verify");
    vi.resetModules();
  });
});
