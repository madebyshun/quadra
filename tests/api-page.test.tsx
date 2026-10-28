import { SKILLS } from "@/skills";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { apiLede, ApiBody, endpointBadge, ENDPOINTS, probeApi } from "@/pages/ApiPage";
import { BRAND } from "@/brand";
import { BLUEAGENT } from "@/config/upstream";
import { apiHandler } from "@/server/api";
import { API_PATH } from "@/server/apiPath";
import type { Facilitator } from "@/server/cdp";

/**
 * This page's job is to be believed, so the tests check a property rather than a paragraph:
 * an endpoint is badged from what this origin ANSWERED when the page asked, and a copyable
 * command for this origin appears only when it did answer.
 *
 * History worth keeping: the page once said "two endpoints, both public, both free to read"
 * with a `curl` for each, and neither existed; later it said "not built", which went stale the
 * day the API was built. Asking the origin is what makes neither failure possible.
 */

const SELLER: Facilitator = {
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: "0x1", network: "eip155:8453" }),
};

/** This origin answered by the real API handler, with or without a facilitator key. */
function served(facilitator: Facilitator | null) {
  const handle = apiHandler({ facilitator });
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => handle(new Request(new URL(url, location.origin), init)));
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

describe("asking this origin", () => {
  it("reads the real API's list as live, with its price and whether it is selling", async () => {
    served(SELLER);
    expect(await probeApi()).toEqual({ kind: "live", skills: SKILLS.length, usd: "$0.005", selling: true });
    served(null);
    expect(await probeApi()).toEqual({ kind: "live", skills: SKILLS.length, usd: "$0.005", selling: false });
  });

  it("reads anything else as absent — a static host's page, an error, the wrong JSON, no answer", async () => {
    for (const answer of [
      () => Promise.resolve(new Response("<!doctype html>")),
      () => Promise.resolve(new Response(JSON.stringify({ skills: [] }), { status: 500 })),
      () => Promise.resolve(new Response(JSON.stringify([]))),
      () => Promise.resolve(new Response(JSON.stringify({ skills: "no" }))),
      () => Promise.reject(new TypeError("offline")),
    ]) {
      vi.stubGlobal("fetch", answer);
      expect(await probeApi()).toEqual({ kind: "absent" });
    }
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ skills: [1], price: null }))));
    expect(await probeApi()).toEqual({ kind: "live", skills: 1, usd: null, selling: false });
  });
});

describe("badges and the lede", () => {
  const live = { kind: "live", skills: 2, usd: "$0.005", selling: true } as const;

  it("badges each endpoint from the answer, and the paid one from whether it is selling", () => {
    expect(endpointBadge({ kind: "reading" }, true)).toEqual({ className: "chip", label: "checking…" });
    expect(endpointBadge({ kind: "absent" }, false)).toEqual({ className: "chip chip--warn", label: "not served here" });
    expect(endpointBadge(live, false)).toEqual({ className: "chip chip--ok", label: "live" });
    expect(endpointBadge(live, true)).toEqual({ className: "chip chip--ok", label: "live" });
    expect(endpointBadge({ ...live, selling: false }, true)).toEqual({ className: "chip chip--warn", label: "not selling yet" });
    expect(endpointBadge({ ...live, selling: false }, false)).toEqual({ className: "chip chip--ok", label: "live" });
  });

  it("says what was found, in each case", () => {
    expect(apiLede({ kind: "reading" }, "https://o.test")).toBe("Asking https://o.test what it serves…");
    expect(apiLede({ kind: "absent" }, "https://o.test")).toContain(`https://o.test answers no API — ${BRAND.name} is being served here without its server.`);
    expect(apiLede(live, "https://o.test")).toBe("https://o.test serves 2 skills over HTTP — the list free, each call from $0.005 over x402.");
    expect(apiLede({ ...live, usd: null }, "https://o.test")).toContain("each call priced over x402");
    expect(apiLede({ ...live, selling: false }, "https://o.test")).toContain("payments are not switched on yet: this server has no Coinbase CDP key");
  });

  it("describes both endpoints under this app's own API path, and says which is paid", () => {
    expect(ENDPOINTS.map((e) => [e.path, e.paid])).toEqual([
      [API_PATH, false],
      [`${API_PATH}/<id>?arg=…`, true],
    ]);
  });
});

describe("the page", () => {
  it("offers no command for this origin while it answers nothing — only somebody else's that does", async () => {
    render(<ApiBody />);
    await settle();
    const list = screen.getByLabelText("Endpoints");
    for (const e of ENDPOINTS) {
      const row = within(list).getByText(`${e.method} ${e.path}`).closest("li") as HTMLElement;
      expect(within(row).getByText("not served here")).toBeInTheDocument();
    }
    const commands = screen.getAllByText(/^curl /).map((el) => el.textContent ?? "");
    expect(commands).toEqual([`curl ${BLUEAGENT.catalog}`]);
  });

  it("shows the commands, and live badges, once this origin has answered", async () => {
    served(SELLER);
    render(<ApiBody />);
    await settle();
    expect(screen.getByLabelText("Try it")).toHaveTextContent(`curl ${location.origin}${API_PATH}`);
    expect(within(screen.getByLabelText("Endpoints")).getAllByText("live")).toHaveLength(2);
    expect(screen.getByText(/PAYMENT-SIGNATURE/)).toBeInTheDocument();
  });

  it("says the paid call is not selling yet when the server has no CDP key", async () => {
    served(null);
    render(<ApiBody />);
    await settle();
    expect(within(screen.getByLabelText("Endpoints")).getByText("not selling yet")).toBeInTheDocument();
  });

  it("drops an answer that arrives after the page closed", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((r) => (release = r)));
    const view = render(<ApiBody />);
    view.unmount();
    release(new Response(JSON.stringify({ skills: [] })));
    await settle();
  });
});
