import { describe, it, expect } from "vitest";
import { BLUEAGENT, CDP } from "@/config/upstream";

/**
 * The rule these protect: the router reads `payTo` out of the live 402 response
 * and pays that. `knownPayTo` exists only to assert against, so that a change
 * upstream shows up as a mismatch instead of a silently misrouted payment. A
 * test that let a hardcoded payee become the send target would defeat the point.
 */

describe("the BlueAgent seam", () => {
  it("talks to blueagent.dev over https", () => {
    for (const url of [BLUEAGENT.base, BLUEAGENT.catalog, BLUEAGENT.mcp]) {
      expect(url.startsWith("https://blueagent.dev")).toBe(true);
    }
  });

  it("builds a tool url from an id", () => {
    expect(BLUEAGENT.tool("hood-live")).toBe("https://blueagent.dev/api/x402/hood-live");
  });

  it("escapes nothing into the path that would change the endpoint", () => {
    const url = new URL(BLUEAGENT.tool("hood-live"));
    expect(url.host).toBe("blueagent.dev");
    expect(url.pathname).toBe("/api/x402/hood-live");
  });

  it("keeps every tool url under the x402 prefix", () => {
    for (const id of ["blue-doctor", "safe-trending", "rh-token-scan"]) {
      expect(BLUEAGENT.tool(id).startsWith(`${BLUEAGENT.base}/api/x402/`)).toBe(true);
    }
  });

  it("records the known payee as a full address", () => {
    expect(BLUEAGENT.knownPayTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("does not expose the known payee under a name that invites sending to it", () => {
    expect(Object.keys(BLUEAGENT)).not.toContain("payTo");
    expect(Object.keys(BLUEAGENT)).toContain("knownPayTo");
  });
});

describe("the CDP facilitator", () => {
  it("points at Coinbase over https", () => {
    for (const url of [CDP.facilitator, CDP.verify, CDP.settle]) {
      expect(url.startsWith("https://api.cdp.coinbase.com/")).toBe(true);
    }
  });

  it("keeps verify and settle as separate endpoints", () => {
    expect(CDP.verify).not.toBe(CDP.settle);
    expect(CDP.verify.endsWith("/verify")).toBe(true);
    expect(CDP.settle.endsWith("/settle")).toBe(true);
  });

  it("hangs both off the facilitator base", () => {
    expect(CDP.verify.startsWith(CDP.facilitator)).toBe(true);
    expect(CDP.settle.startsWith(CDP.facilitator)).toBe(true);
  });

  it("carries no credential in the url", () => {
    for (const url of [CDP.facilitator, CDP.verify, CDP.settle]) {
      expect(url).not.toMatch(/key|secret|token|[?&]/i);
    }
  });
});
